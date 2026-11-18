import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_ID = "9be3d5ee-e09a-4738-9b27-f2fae15e93c7";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function splitIngredients(formula: string): string[] {
  return formula.split(/\s*(?:\+|;|,|\band\b)\s*/i)
    .map((part) => part
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|μg|g|kg|ml|mL|iu|units?|%|meq)\b/gi, "")
      .replace(/\b\d+\s*(?:million|billion)\s*(?:cfu|spores?|cells?)\b/gi, "")
      .replace(/\b(?:eq\.?\s*to|equivalent\s+to)\b.*$/i, "")
      .replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
const norm = (v: unknown) => String(v ?? "").toLowerCase()
  .replace(/hydrochloride/g, "hcl").replace(/[^a-z0-9]+/g, " ").trim();
const first = (v: unknown) => Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");

async function verifyMedicine(m: any, force = false) {
  if (!m.composition?.trim()) return { id: m.id, status: "not_verified", reason: "Formula missing" };
  if (!force && m.info_status === "matched_official_label") {
    return { id: m.id, status: "matched_official_label", skipped: true };
  }
  const ingredients = splitIngredients(m.composition);
  if (!ingredients.length) throw new Error("Could not parse active ingredients");
  const query = ingredients.map((x) => 'openfda.active_ingredient:"' + x.replace(/["\\]/g, "") + '"').join(" AND ");
  const endpoint = "https://api.fda.gov/drug/label.json?search=" + encodeURIComponent(query) + "&limit=25";
  const response = await fetch(endpoint, { headers: { "Accept": "application/json" } });
  if (!response.ok) {
    await supabase.from("medicines").update({
      info_status: "not_verified", info_checked_at: new Date().toISOString(),
      info_source_url: null, mechanism_of_action: null, uses: null, benefits: null,
      side_effects: null, precautions: null,
    }).eq("id", m.id);
    return { id: m.id, status: "not_verified", reason: "No official matching label in FDA database" };
  }
  const payload = await response.json();
  const match = (payload.results ?? []).find((record: any) => {
    const listed = norm([...(record.openfda?.active_ingredient ?? []), ...(record.openfda?.generic_name ?? [])].join(" "));
    return ingredients.every((part) => listed.includes(norm(part)));
  });
  if (!match) {
    await supabase.from("medicines").update({
      info_status: "not_verified", info_checked_at: new Date().toISOString(),
      info_source_url: null, mechanism_of_action: null, uses: null, benefits: null,
      side_effects: null, precautions: null,
    }).eq("id", m.id);
    return { id: m.id, status: "not_verified", reason: "No exact active-ingredient match" };
  }
  const mechanism = first(match.mechanism_of_action) || first(match.clinical_pharmacology);
  const uses = first(match.indications_and_usage) || first(match.purpose);
  const sideEffects = first(match.adverse_reactions);
  const precautions = [first(match.warnings), first(match.precautions), first(match.do_not_use)].filter(Boolean).join("\n\n");
  const hasUsefulData = Boolean(mechanism || uses || sideEffects || precautions);
  if (!hasUsefulData) {
    await supabase.from("medicines").update({
      info_status: "not_verified", info_checked_at: new Date().toISOString(),
      info_source_url: endpoint, mechanism_of_action: null, uses: null, benefits: null,
      side_effects: null, precautions: null,
    }).eq("id", m.id);
    return { id: m.id, status: "not_verified", reason: "Official label has insufficient clinical details" };
  }
  const { error } = await supabase.from("medicines").update({
    mechanism_of_action: mechanism || null,
    uses: uses || null,
    benefits: null,
    side_effects: sideEffects || null,
    precautions: precautions || null,
    info_source_url: endpoint,
    info_status: "matched_official_label",
    info_checked_at: new Date().toISOString(),
  }).eq("id", m.id);
  if (error) throw error;
  return { id: m.id, status: "matched_official_label", fields: {
    mechanism: Boolean(mechanism), uses: Boolean(uses), benefits: false,
    side_effects: Boolean(sideEffects), precautions: Boolean(precautions),
  }};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user || user.id !== ADMIN_ID) return json({ error: "Admin access required" }, 403);
    const body = await req.json();
    if (body.action === "one") {
      const { data: medicine, error } = await supabase.from("medicines")
        .select("id,composition,info_status").eq("id", body.medicine_id).single();
      if (error) throw error;
      return json(await verifyMedicine(medicine, true));
    }
    if (body.action === "backfill") {
      const { data: medicines, error } = await supabase.from("medicines")
        .select("id,composition,info_status")
        .order("name").limit(100);
      if (error) throw error;
      const results = [];
      for (const medicine of medicines ?? []) {
        try { results.push(await verifyMedicine(medicine, body.force === true)); }
        catch (e) { results.push({ id: medicine.id, status: "error", reason: String(e) }); }
      }
      return json({ processed: results.length, matched: results.filter((x: any) => x.status === "matched_official_label").length,
        not_verified: results.filter((x: any) => x.status === "not_verified").length, results });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("medicine-formula-info error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: detail }, 500);
  }
});