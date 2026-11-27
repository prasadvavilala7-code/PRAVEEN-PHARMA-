/* PRAVEEN PHARMA Customer Follow-up UI.
   Uses the existing authenticated Admin Supabase session. */
(function () {
  "use strict";
  const FU = { contacts: [], templates: [], schedules: [], settings: null, activeTab: "customers", ready: false };
  const byId = (id) => document.getElementById(id);
  const phoneDigits = (value) => String(value || "").replace(/\D/g, "");
  const normalizedPhone = (value) => {
    let digits = phoneDigits(value);
    if (digits.length === 10) digits = "91" + digits;
    return digits;
  };
  const dateLabel = (value) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const say = (message, bad = false) => {
    const el = byId("fuStatus");
    if (el) { el.textContent = message; el.classList.toggle("fu-error", !!bad); }
  };
  const escape = (value) => typeof esc === "function" ? esc(value) : String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function setTab(tab) {
    FU.activeTab = tab;
    document.querySelectorAll("[data-fu-tab]").forEach(button => button.classList.toggle("active", button.dataset.fuTab === tab));
    document.querySelectorAll("[data-fu-view]").forEach(view => { view.hidden = view.dataset.fuView !== tab; });
    if (tab === "customers") renderContacts();
    if (tab === "schedule") renderSchedules();
    if (tab === "templates") renderTemplates();
    if (tab === "automatic") renderAutomatic();
    if (tab === "manual") renderManual();
    if (tab === "history") loadHistory();
    if (tab === "settings") renderSettings();
  }

  async function loadSettings() {
    const { data, error } = await db.from("followup_settings").select("*").eq("id", true).maybeSingle();
    if (error) throw error;
    if (data) { FU.settings = data; return data; }
    const { data: created, error: insertError } = await db.from("followup_settings").insert({ id: true }).select("*").single();
    if (insertError) throw insertError;
    FU.settings = created;
    return created;
  }

  async function loadContacts() {
    const { data, error } = await db.from("followup_contacts").select("*").order("updated_at", { ascending: false }).limit(500);
    if (error) throw error;
    FU.contacts = data || [];
    renderContacts();
    renderContactSelects();
    updateStats();
  }

  async function importFromOrders() {
    say("Importing recent order customers…");
    const { data: orders, error } = await db.from("orders")
      .select("id,retailer_id,customer_name,phone,created_at")
      .order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    const retailerIds = [...new Set((orders || []).map(x => x.retailer_id).filter(Boolean))];
    let profiles = [];
    if (retailerIds.length) {
      const result = await db.from("retailer_profiles").select("user_id,shop_name,owner_name,phone").in("user_id", retailerIds);
      if (result.error) throw result.error;
      profiles = result.data || [];
    }
    const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]));
    const existing = new Set(FU.contacts.map(c => c.phone_normalized));
    const additions = [];
    (orders || []).forEach(order => {
      const profile = profileMap[order.retailer_id] || {};
      const rawPhone = order.phone || profile.phone;
      const phone = normalizedPhone(rawPhone);
      if (!phone || phone.length < 10 || existing.has(phone)) return;
      existing.add(phone);
      additions.push({
        customer_name: order.customer_name || profile.owner_name || profile.shop_name || "Customer",
        shop_name: profile.shop_name || null,
        phone: rawPhone || phone,
        phone_normalized: phone,
        source: "order_import",
        whatsapp_opt_in: false,
        do_not_contact: false
      });
    });
    if (!additions.length) { say("No new customers to import. Existing contacts were kept unchanged."); return; }
    const { error: saveError } = await db.from("followup_contacts").insert(additions);
    if (saveError) throw saveError;
    await loadContacts();
    say(additions.length + " customers imported. WhatsApp consent is OFF by default; enable it only after the customer agrees.");
  }

  function renderContacts() {
    const box = byId("fuContactRows");
    if (!box) return;
    if (!FU.contacts.length) { box.innerHTML = '<p class="muted">No customers yet. Add a customer or import them from existing orders.</p>'; return; }
    box.innerHTML = FU.contacts.map(c => {
      const permitted = c.whatsapp_opt_in && !c.do_not_contact;
      return '<div class="fu-row"><div class="fu-person"><b>' + escape(c.customer_name) + '</b><small>' + escape(c.shop_name || "—") + ' · ' + escape(c.phone) + '</small><small>Consent: ' + (permitted ? "Yes" : "No") + (c.consent_at ? " · " + escape(dateLabel(c.consent_at)) : "") + '</small></div><div class="fu-actions"><span class="fu-pill ' + (permitted ? "ok" : "off") + '">' + (permitted ? "WhatsApp Opt-in" : (c.do_not_contact ? "Do not contact" : "No consent")) + '</span><button type="button" class="secondary" data-fu-consent="' + c.id + '" data-fu-next="' + (!permitted) + '">' + (permitted ? "Revoke" : "Enable consent") + '</button><button type="button" class="secondary" data-fu-message="' + c.id + '">Message</button></div></div>';
    }).join("");
    box.querySelectorAll("[data-fu-consent]").forEach(button => button.addEventListener("click", () => changeConsent(button.dataset.fuConsent, button.dataset.fuNext === "true")));
    box.querySelectorAll("[data-fu-message]").forEach(button => button.addEventListener("click", () => {
      const contact = FU.contacts.find(x => x.id === button.dataset.fuMessage);
      if (contact) { setTab("manual"); byId("fuManualContact").value = contact.id; renderManual(); }
    }));
  }

  async function changeConsent(id, enable) {
    const contact = FU.contacts.find(x => x.id === id);
    if (!contact) return;
    if (enable && !window.confirm("Confirm that this customer has explicitly agreed to receive WhatsApp messages from PRAVEEN PHARMA. Continue?")) return;
    let patch;
    if (enable) {
      const source = window.prompt("How did the customer give consent? (e.g. WhatsApp opt-in / written / verbal)", "WhatsApp opt-in");
      if (!source || !source.trim()) { say("Consent source is required.", true); return; }
      patch = { whatsapp_opt_in: true, consent_source: source.trim(), consent_at: new Date().toISOString(), do_not_contact: false };
    } else {
      patch = { whatsapp_opt_in: false, do_not_contact: true };
    }
    const { error } = await db.from("followup_contacts").update(patch).eq("id", id);
    if (error) throw error;
    await loadContacts();
    say(enable ? "Customer consent saved." : "Customer opted out. Follow-up is blocked.");
  }

  async function addContact() {
    const name = byId("fuNewName").value.trim();
    const shop = byId("fuNewShop").value.trim();
    const phone = byId("fuNewPhone").value.trim();
    const digits = normalizedPhone(phone);
    if (!name || digits.length < 10 || digits.length > 15) { say("Enter customer name and a valid phone number.", true); return; }
    const opted = byId("fuNewConsent").checked;
    let consentSource = null;
    if (opted) {
      if (!window.confirm("Has this customer explicitly agreed to receive WhatsApp messages from PRAVEEN PHARMA?")) return;
      consentSource = byId("fuConsentSource").value.trim();
      if (!consentSource) { say("Enter the consent source before enabling WhatsApp.", true); return; }
    }
    const { error } = await db.from("followup_contacts").insert({
      customer_name: name, shop_name: shop || null, phone, phone_normalized: digits,
      source: "manual", whatsapp_opt_in: opted, consent_source: consentSource,
      consent_at: opted ? new Date().toISOString() : null, do_not_contact: false
    });
    if (error) throw error;
    ["fuNewName","fuNewShop","fuNewPhone","fuConsentSource"].forEach(id => { if (byId(id)) byId(id).value = ""; });
    byId("fuNewConsent").checked = false;
    await loadContacts();
    say("Customer saved. WhatsApp follow-up is " + (opted ? "enabled with recorded consent." : "disabled until consent is recorded."));
  }

  function renderContactSelects() {
    ["fuScheduleContact","fuManualContact"].forEach(id => {
      const select = byId(id);
      if (!select) return;
      const previous = select.value;
      select.innerHTML = '<option value="">Select customer</option>' + FU.contacts.map(c => '<option value="' + c.id + '">' + escape(c.customer_name) + ' — ' + escape(c.phone) + (c.whatsapp_opt_in && !c.do_not_contact ? "" : " (no consent)") + '</option>').join("");
      if (FU.contacts.some(c => c.id === previous)) select.value = previous;
    });
  }

  async function loadTemplates() {
    const { data, error } = await db.from("followup_templates").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    FU.templates = data || [];
    renderTemplates();
  }

  function renderTemplates() {
    const box = byId("fuTemplateRows");
    if (!box) return;
    box.innerHTML = FU.templates.length ? FU.templates.map(t =>
      '<div class="fu-row"><div class="fu-person"><b>' + escape(t.name) + '</b><small>' + escape(t.body) + '</small><small>Meta template: ' + escape(t.meta_template_name || "Not linked") + ' · ' + escape(t.language_code) + ' · ' + (t.meta_approved ? "Marked approved" : "Not approved") + '</small></div><div class="fu-actions"><span class="fu-pill ' + (t.is_active ? "ok" : "off") + '">' + (t.is_active ? "Active" : "Paused") + '</span><button type="button" class="secondary" data-fu-edit-template="' + t.id + '">Edit</button><button type="button" class="secondary" data-fu-toggle-template="' + t.id + '">' + (t.is_active ? "Pause" : "Activate") + '</button></div></div>'
    ).join("") : '<p class="muted">No message templates saved yet.</p>';
    box.querySelectorAll("[data-fu-edit-template]").forEach(b => b.onclick = () => {
      const t = FU.templates.find(x => x.id === b.dataset.fuEditTemplate);
      if (!t) return;
      byId("fuTemplateId").value = t.id; byId("fuTemplateName").value = t.name;
      byId("fuTemplateBody").value = t.body; byId("fuMetaTemplateName").value = t.meta_template_name || "";
      byId("fuTemplateLanguage").value = t.language_code || "en"; byId("fuMetaApproved").checked = !!t.meta_approved;
    });
    box.querySelectorAll("[data-fu-toggle-template]").forEach(b => b.onclick = async () => {
      const t = FU.templates.find(x => x.id === b.dataset.fuToggleTemplate);
      if (!t) return;
      const { error } = await db.from("followup_templates").update({ is_active: !t.is_active }).eq("id", t.id);
      if (error) throw error;
      await loadTemplates();
    });
  }

  async function saveTemplate() {
    const id = byId("fuTemplateId").value || null;
    const name = byId("fuTemplateName").value.trim();
    const body = byId("fuTemplateBody").value.trim();
    const metaName = byId("fuMetaTemplateName").value.trim();
    const language = byId("fuTemplateLanguage").value.trim() || "en";
    const approved = byId("fuMetaApproved").checked;
    if (!name || !body) { say("Template name and message are required.", true); return; }
    if (approved && !metaName) { say("Enter the exact Meta-approved template name.", true); return; }
    const payload = { name, body, meta_template_name: metaName || null, language_code: language, meta_approved: approved, is_active: true };
    const result = id
      ? await db.from("followup_templates").update(payload).eq("id", id)
      : await db.from("followup_templates").insert(payload);
    if (result.error) throw result.error;
    byId("fuTemplateId").value = "";
    ["fuTemplateName","fuTemplateBody","fuMetaTemplateName"].forEach(x => byId(x).value = "");
    byId("fuTemplateLanguage").value = "en"; byId("fuMetaApproved").checked = false;
    await loadTemplates();
    say("Message template saved. Meta approval must match the exact approved template before automatic sending.");
  }

  function renderSchedules() {
    const box = byId("fuScheduleRows");
    if (!box) return;
    if (!FU.schedules.length) { box.innerHTML = '<p class="muted">No scheduled follow-ups yet.</p>'; return; }
    const contacts = Object.fromEntries(FU.contacts.map(c => [c.id, c]));
    box.innerHTML = FU.schedules.map(s => {
      const c = contacts[s.contact_id] || {};
      return '<div class="fu-row"><div class="fu-person"><b>' + escape(c.customer_name || "Customer") + ' · ' + escape(c.phone || "") + '</b><small>' + escape(dateLabel(s.scheduled_for)) + ' · ' + escape(s.channel) + '</small>' + (s.last_error ? '<small class="fu-error">' + escape(s.last_error) + '</small>' : '') + '</div><div class="fu-actions"><span class="fu-pill ' + (s.status === "sent" ? "ok" : s.status === "failed" ? "off" : "wait") + '">' + escape(s.status) + '</span>' + (s.status === "pending" ? '<button class="secondary" data-fu-schedule="' + s.id + '" data-fu-state="paused">Pause</button>' : '') + (s.status === "paused" ? '<button class="secondary" data-fu-schedule="' + s.id + '" data-fu-state="pending">Resume</button>' : '') + (["pending","paused","failed"].includes(s.status) ? '<button class="secondary" data-fu-schedule="' + s.id + '" data-fu-state="cancelled">Cancel</button>' : '') + '</div></div>';
    }).join("");
    box.querySelectorAll("[data-fu-schedule]").forEach(b => b.onclick = () => updateSchedule(b.dataset.fuSchedule, b.dataset.fuState));
  }

  async function loadSchedules() {
    const { data, error } = await db.from("followup_schedule").select("*").order("scheduled_for", { ascending: true }).limit(300);
    if (error) throw error;
    FU.schedules = data || [];
    renderSchedules();
    updateStats();
  }

  async function updateSchedule(id, status) {
    const { error } = await db.from("followup_schedule").update({ status }).eq("id", id);
    if (error) throw error;
    await loadSchedules();
    say("Schedule updated.");
  }

  async function createSchedule() {
    const contactId = byId("fuScheduleContact").value;
    const contact = FU.contacts.find(c => c.id === contactId);
    if (!contactId || !contact) { say("Select a customer first.", true); return; }
    if (!contact.whatsapp_opt_in || contact.do_not_contact) { say("This customer has not opted in to WhatsApp. Obtain consent first.", true); return; }
    const baseValue = byId("fuBaseDate").value;
    const base = baseValue ? new Date(baseValue + "T10:00:00") : new Date();
    const days = (FU.settings?.schedule_days || [7,15,30]).filter(n => Number.isInteger(n) && n > 0);
    const rows = days.map(day => {
      const due = new Date(base); due.setDate(due.getDate() + day);
      return {
        contact_id: contactId, channel: "automatic", scheduled_for: due.toISOString(),
        status: "pending", message_override: byId("fuScheduleMessage").value.trim() || null,
        idempotency_key: "admin:" + contactId + ":" + base.toISOString().slice(0,10) + ":" + day
      };
    });
    const { error } = await db.from("followup_schedule").upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw error;
    await loadSchedules();
    say(days.length + " follow-up reminders scheduled. Automatic delivery still requires the WhatsApp API and scheduler setup.");
  }

  function renderAutomatic() {
    const settings = FU.settings || {};
    const enabled = !!settings.automatic_enabled;
    const approved = FU.templates.some(t => t.is_active && t.meta_approved && t.meta_template_name);
    byId("fuAutoState").textContent = enabled ? "Automatic follow-up is enabled in settings." : "Automatic follow-up is currently paused.";
    byId("fuAutoTemplateState").textContent = approved ? "An active template is marked Meta-approved." : "No active Meta-approved template is configured.";
    byId("fuAutoApiState").textContent = "WhatsApp API credentials and the 5-minute scheduler must be configured before automatic messages can be sent.";
    byId("fuAutoPending").textContent = String(FU.schedules.filter(s => s.channel === "automatic" && s.status === "pending").length);
  }

  function renderSettings() {
    const settings = FU.settings || {};
    byId("fuSettingDays").value = (settings.schedule_days || [7,15,30]).join(", ");
    byId("fuSettingAutomatic").checked = !!settings.automatic_enabled;
    byId("fuSettingManual").checked = settings.manual_enabled !== false;
  }

  async function saveSettings() {
    const days = [...new Set(byId("fuSettingDays").value.split(",").map(x => Number(x.trim())).filter(Number.isInteger))].sort((a,b) => a-b);
    if (!days.length || days.length > 10 || days.some(x => x < 1 || x > 365)) { say("Enter 1–10 reminder intervals, each from 1 to 365 days (example: 7, 15, 30).", true); return; }
    const payload = {
      id: true, schedule_days: days,
      automatic_enabled: byId("fuSettingAutomatic").checked,
      manual_enabled: byId("fuSettingManual").checked,
      updated_by: currentUser?.id || null, updated_at: new Date().toISOString()
    };
    const { data, error } = await db.from("followup_settings").upsert(payload, { onConflict: "id" }).select("*").single();
    if (error) throw error;
    FU.settings = data;
    renderSettings(); renderAutomatic();
    say("Follow-up settings saved.");
  }

  function renderManual() {
    const contact = FU.contacts.find(c => c.id === byId("fuManualContact").value);
    const allowed = !!(contact && contact.whatsapp_opt_in && !contact.do_not_contact && FU.settings?.manual_enabled !== false);
    byId("fuManualConsent").textContent = !contact ? "Select a customer." : allowed ? "Consent verified. You can open WhatsApp with a prepared message." : "Manual follow-up is blocked: customer consent is missing or manual mode is disabled.";
    byId("fuManualSend").disabled = !allowed;
  }

  async function sendManual() {
    const contact = FU.contacts.find(c => c.id === byId("fuManualContact").value);
    const message = byId("fuManualMessage").value.trim();
    if (!contact || !contact.whatsapp_opt_in || contact.do_not_contact) { say("Customer WhatsApp consent is required.", true); return; }
    if (FU.settings?.manual_enabled === false) { say("Manual follow-up is disabled in settings.", true); return; }
    if (!message) { say("Enter a message first.", true); return; }
    const phone = normalizedPhone(contact.phone);
    if (phone.length < 10) { say("Customer phone number is invalid.", true); return; }
    const url = "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);
    window.open(url, "_blank", "noopener");
    const { error } = await db.from("followup_logs").insert({
      contact_id: contact.id, channel: "manual", recipient_phone: contact.phone,
      message_text: message, status: "opened", created_by: currentUser?.id || null
    });
    if (error) throw error;
    say("WhatsApp opened with the prepared message. Tap Send in WhatsApp to actually send it.");
    await loadHistory();
  }

  async function loadHistory() {
    const box = byId("fuHistoryRows");
    if (!box) return;
    const { data, error } = await db.from("followup_logs").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const rows = data || [];
    const contacts = Object.fromEntries(FU.contacts.map(c => [c.id, c]));
    box.innerHTML = rows.length ? rows.map(log => {
      const c = contacts[log.contact_id] || {};
      return '<div class="fu-row"><div class="fu-person"><b>' + escape(c.customer_name || "Customer") + ' · ' + escape(log.recipient_phone) + '</b><small>' + escape(dateLabel(log.created_at)) + ' · ' + escape(log.channel) + '</small><small>' + escape(log.message_text) + '</small></div><span class="fu-pill ' + (["sent","delivered","read"].includes(log.status) ? "ok" : "wait") + '">' + escape(log.status) + '</span></div>';
    }).join("") : '<p class="muted">No follow-up history yet.</p>';
  }

  function updateStats() {
    if (byId("fuStatCustomers")) byId("fuStatCustomers").textContent = String(FU.contacts.length);
    if (byId("fuStatOptIn")) byId("fuStatOptIn").textContent = String(FU.contacts.filter(c => c.whatsapp_opt_in && !c.do_not_contact).length);
    if (byId("fuStatPending")) byId("fuStatPending").textContent = String(FU.schedules.filter(s => s.status === "pending").length);
    if (byId("fuStatSent")) byId("fuStatSent").textContent = String(FU.schedules.filter(s => s.status === "sent").length);
  }

  window.initFollowupModule = async function () {
    if (FU.ready) return;
    FU.ready = true;
    try {
      await loadSettings();
      await loadContacts();
      await loadTemplates();
      await loadSchedules();
      renderSettings(); renderAutomatic(); renderManual();
      byId("fuAddContact").addEventListener("click", () => addContact().catch(e => say(e.message || String(e), true)));
      byId("fuImportOrders").addEventListener("click", () => importFromOrders().catch(e => say(e.message || String(e), true)));
      byId("fuSaveTemplate").addEventListener("click", () => saveTemplate().catch(e => say(e.message || String(e), true)));
      byId("fuClearTemplate").addEventListener("click", () => {
        byId("fuTemplateId").value = ""; ["fuTemplateName","fuTemplateBody","fuMetaTemplateName"].forEach(x => byId(x).value = "");
        byId("fuTemplateLanguage").value = "en"; byId("fuMetaApproved").checked = false;
      });
      byId("fuCreateSchedule").addEventListener("click", () => createSchedule().catch(e => say(e.message || String(e), true)));
      byId("fuSaveSettings").addEventListener("click", () => saveSettings().catch(e => say(e.message || String(e), true)));
      byId("fuManualContact").addEventListener("change", renderManual);
      byId("fuManualSend").addEventListener("click", () => sendManual().catch(e => say(e.message || String(e), true)));
      document.querySelectorAll("[data-fu-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.fuTab)));
      byId("fuBaseDate").value = new Date().toISOString().slice(0,10);
      setTab("customers");
      say("Follow-up module ready. Manual WhatsApp opens a prefilled chat; automatic sending needs Meta API setup.");
    } catch (error) {
      FU.ready = false;
      say("Follow-up could not load: " + (error?.message || String(error)) + ". Run supabase/customer-followup.sql and reload.", true);
    }
  };

  window.loadFollowupModule = window.initFollowupModule;
})();
