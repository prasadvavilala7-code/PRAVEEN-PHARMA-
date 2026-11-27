import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-followup-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const digits = (value: string) => {
  let result = String(value || "").replace(/\D/g, "");
  if (result.length === 10) result = "91" + result;
  return result;
};

function renderMessage(templateBody: string, contact: { customer_name?: string; shop_name?: string }) {
  return String(templateBody || "")
    .replace(/\{\{\s*customer_name\s*\}\}/gi, contact.customer_name || "Customer")
    .replace(/\{\{\s*shop_name\s*\}\}/gi, contact.shop_name || "your shop");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const cronSecret = Deno.env.get("FOLLOWUP_CRON_SECRET");
  const suppliedSecret = req.headers.get("x-followup-cron-secret");
  if (!cronSecret || !suppliedSecret || suppliedSecret !== cronSecret) {
    return json({ error: "Unauthorized scheduler request" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = Deno.env.get("META_WA_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("META_WA_PHONE_NUMBER_ID");
  const graphVersion = Deno.env.get("META_WA_GRAPH_VERSION");

  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase server configuration is missing" }, 500);
  if (!accessToken || !phoneNumberId || !graphVersion || !/^v\d+\.\d+$/.test(graphVersion)) {
    return json({ error: "WhatsApp Cloud API secrets are not configured. Add META_WA_ACCESS_TOKEN, META_WA_PHONE_NUMBER_ID and META_WA_GRAPH_VERSION." }, 503);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const { data: settings, error: settingsError } = await db
    .from("followup_settings").select("automatic_enabled,schedule_days").eq("id", true).maybeSingle();
  if (settingsError) return json({ error: settingsError.message }, 500);
  if (!settings?.automatic_enabled) return json({ ok: true, message: "Automatic follow-up is paused", scheduled: 0, sent: 0 });

  // Create idempotent reminders for opted-in customers with recent orders.
  const cutoff = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: orders, error: orderError }, { data: contacts, error: contactError }, { data: templates, error: templateError }] = await Promise.all([
    db.from("orders").select("id,customer_name,phone,created_at,order_status").gte("created_at", cutoff).not("phone", "is", null).order("created_at", { ascending: false }).limit(5000),
    db.from("followup_contacts").select("id,customer_name,shop_name,phone,phone_normalized,whatsapp_opt_in,do_not_contact").eq("whatsapp_opt_in", true).eq("do_not_contact", false).limit(5000),
    db.from("followup_templates").select("id,body,meta_template_name,language_code").eq("is_active", true).eq("meta_approved", true).not("meta_template_name", "is", null).order("created_at", { ascending: false }).limit(1),
  ]);
  if (orderError || contactError || templateError) {
    return json({ error: orderError?.message || contactError?.message || templateError?.message }, 500);
  }

  const contactByPhone = new Map((contacts || []).map(c => [c.phone_normalized, c]));
  const template = templates?.[0] || null;
  const scheduleRows: Record<string, unknown>[] = [];
  for (const order of orders || []) {
    if (["cancelled", "canceled", "rejected"].includes(String(order.order_status || "").toLowerCase())) continue;
    const phone = digits(order.phone || "");
    const contact = contactByPhone.get(phone);
    if (!contact) continue;
    for (const delay of settings.schedule_days || []) {
      const due = new Date(new Date(order.created_at).getTime() + Number(delay) * 86400000);
      // Do not send a backlog of reminders if the scheduler was offline for more than 24 hours.
      if (due.getTime() < now.getTime() - 24 * 60 * 60 * 1000) continue;
      scheduleRows.push({
        contact_id: contact.id,
        order_id: order.id,
        template_id: template?.id || null,
        channel: "automatic",
        scheduled_for: due.toISOString(),
        status: "pending",
        idempotency_key: `order:${order.id}:day:${delay}`,
      });
    }
  }

  let scheduled = 0;
  for (let i = 0; i < scheduleRows.length; i += 500) {
    const batch = scheduleRows.slice(i, i + 500);
    const { data, error } = await db.from("followup_schedule")
      .upsert(batch, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
    if (error) return json({ error: error.message }, 500);
    scheduled += data?.length || 0;
  }

  const { data: dueRows, error: dueError } = await db.from("followup_schedule")
    .select("id,contact_id,template_id,message_override,attempts,contact:followup_contacts(id,customer_name,shop_name,phone,whatsapp_opt_in,do_not_contact),template:followup_templates(id,body,meta_template_name,language_code,meta_approved,is_active)")
    .eq("channel", "automatic").eq("status", "pending").lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true }).limit(50);
  if (dueError) return json({ error: dueError.message, scheduled }, 500);

  let sent = 0;
  let failed = 0;
  for (const item of dueRows || []) {
    const contact = Array.isArray(item.contact) ? item.contact[0] : item.contact;
    const joinedTemplate = Array.isArray(item.template) ? item.template[0] : item.template;
    const tpl = joinedTemplate || template;
    if (!contact?.whatsapp_opt_in || contact?.do_not_contact) {
      await db.from("followup_schedule").update({ status: "cancelled", last_error: "Customer consent missing or revoked" }).eq("id", item.id);
      continue;
    }
    if (!tpl?.meta_approved || !tpl?.meta_template_name || !tpl?.language_code) {
      const reason = "No active Meta-approved template is linked to this reminder";
      await db.from("followup_schedule").update({ status: "failed", attempts: Number(item.attempts || 0) + 1, last_error: reason }).eq("id", item.id);
      await db.from("followup_logs").insert({
        contact_id: contact.id, schedule_id: item.id, channel: "automatic",
        recipient_phone: contact.phone, message_text: item.message_override || tpl?.body || "",
        status: "failed", error: reason,
      });
      failed++;
      continue;
    }

    const messageText = renderMessage(item.message_override || tpl.body, contact);
    const recipient = digits(contact.phone);
    try {
      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: tpl.meta_template_name,
            language: { code: tpl.language_code },
            // The approved Meta template must contain exactly one body placeholder {{1}}.
            components: [{ type: "body", parameters: [{ type: "text", text: messageText.slice(0, 1024) }] }],
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message || `WhatsApp API returned HTTP ${response.status}`);
      const providerId = result?.messages?.[0]?.id || null;
      await db.from("followup_schedule").update({
        status: "sent", attempts: Number(item.attempts || 0) + 1,
        sent_at: new Date().toISOString(), last_error: null,
      }).eq("id", item.id);
      await db.from("followup_logs").insert({
        contact_id: contact.id, schedule_id: item.id, channel: "automatic",
        recipient_phone: contact.phone, message_text: messageText,
        status: "sent", provider_message_id: providerId,
      });
      sent++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await db.from("followup_schedule").update({
        status: "failed", attempts: Number(item.attempts || 0) + 1, last_error: reason,
      }).eq("id", item.id);
      await db.from("followup_logs").insert({
        contact_id: contact.id, schedule_id: item.id, channel: "automatic",
        recipient_phone: contact.phone, message_text: messageText,
        status: "failed", error: reason,
      });
      failed++;
    }
  }

  return json({ ok: true, scheduled, due: dueRows?.length || 0, sent, failed });
});
