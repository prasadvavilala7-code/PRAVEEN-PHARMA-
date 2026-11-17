import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const alertTo = Deno.env.get("ALERT_TO_EMAIL");
    const alertFrom = Deno.env.get("ALERT_FROM_EMAIL");

    if (!resendKey || !alertTo || !alertFrom) {
      return new Response(JSON.stringify({ error: "Email secrets are not configured." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "Missing access token." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: "Invalid session." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const configuredAdminId = "9be3d5ee-e09a-4738-9b27-f2fae15e93c7";
    const isConfiguredAdmin = user.id === configuredAdminId;
    const source = String(body.source || "admin-dashboard").slice(0, 80);
    const userAgent = String(body.user_agent || "").slice(0, 500);

    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { error: logError } = await service.from("admin_login_alerts").insert({
      user_id: user.id,
      user_email: user.email || null,
      is_configured_admin: isConfiguredAdmin,
      source,
      user_agent: userAgent || null,
    });
    if (logError) throw logError;

    const timestamp = new Date().toISOString();
    const subject = isConfiguredAdmin ? "PRAVEEN PHARMA: Admin dashboard login" : "SECURITY ALERT: Unapproved Admin dashboard login";
    const textBody = [
      isConfiguredAdmin ? "The configured Admin account signed in." : "An account other than the configured Admin signed in to the Admin Dashboard.",
      "",
      "Account: " + (user.email || "Email unavailable"),
      "User ID: " + user.id,
      "Access status: " + (isConfiguredAdmin ? "Configured Admin" : "NOT the configured Admin"),
      "Time (UTC): " + timestamp,
      "Source: " + source,
      "Device / browser: " + (userAgent || "Not provided"),
      "",
      "If this was not you, secure the account and review Supabase Auth users/sessions.",
    ].join("\\n");

    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from: alertFrom, to: [alertTo], subject, text: textBody }),
    });
    if (!mail.ok) {
      const detail = await mail.text();
      return new Response(JSON.stringify({ error: "Login recorded, but email delivery failed.", detail }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, recorded: true, emailed: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
