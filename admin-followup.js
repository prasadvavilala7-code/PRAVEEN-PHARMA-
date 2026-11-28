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
      return '<div class="fu-row"><div class="fu-person"><b>' + escape(c.customer_name || "Customer") + ' · ' + escape(c.phone || "") + '</b><small>' + escape(dateLabel(s.scheduled_for)) + ' · ' + escape(s.channel) + '</small>' + (s.last_error ? '<small class="fu-error">' + escape(s.last_error) + '</small>' : '') + '</div><div class="fu-actions"><span class="fu-pill ' + (s.status === "sent" ? "ok" : s.status === "failed" ? "off" : "wait") + '">' + escape(s.status) + '</span>' + (s.status === "pending" ? '<button class="secondary" data-fu-schedule="' + s.id + '" data-fu-state="paused">Pause</button>' : '') + (s.status === "paused" ? '<button class="secondary" data-fu-schedule="' + s.id + '" data-fu-state="pending">Resume</button>' : '') + (["pending","paused","failed"].includes(s.status) ? '<button class="secondary" data-fu-schedule="' + s.id + '" data-fu-state="cancelled">Cancel</button>' : '') + (s.status === "failed" ? '<button class="secondary" data-fu-schedule="' + s.id + '" data-fu-state="pending">Retry</button>' : '') + '</div></div>';
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

  // Bulk follow-up queue: only customers with recorded WhatsApp opt-in are eligible.
  let FU_BULK = { ids: [], index: 0 };
  function renderBulkRecipients() {
    const box = byId("fuBulkRecipients");
    if (!box) return;
    const eligible = FU.contacts.filter(c => c.whatsapp_opt_in && !c.do_not_contact && normalizedPhone(c.phone).length >= 10);
    box.innerHTML = eligible.length ? eligible.map(c =>
      '<label class="fu-check" style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #34364d"><input type="checkbox" data-fu-bulk-id="' + escape(c.id) + '" checked style="width:auto;min-height:0;margin:0"><span>' + escape(c.customer_name) + ' · ' + escape(c.phone) + '</span></label>'
    ).join("") : '<p class="muted">No customers with valid numbers and recorded WhatsApp consent.</p>';
    const count = box.querySelectorAll("[data-fu-bulk-id]:checked").length;
    if (byId("fuBulkCount")) byId("fuBulkCount").textContent = count + " selected · " + eligible.length + " eligible";
  }
  function setupBulkFollowup() {
    const card = document.querySelector('[data-fu-view="manual"] .fu-card');
    if (!card || byId("fuBulkPanel")) return;
    const panel = document.createElement("div");
    panel.id = "fuBulkPanel";
    panel.className = "fu-card";
    panel.style.marginTop = "18px";
    panel.innerHTML = '<h3>Bulk WhatsApp Follow-up</h3><p class="muted">Select all opted-in customers and process them one by one. WhatsApp still requires you to press Send in each chat.</p><p id="fuBulkCount" class="fu-status">Loading eligible customers…</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button type="button" class="secondary" id="fuBulkSelectAll">Select All Eligible</button><button type="button" class="secondary" id="fuBulkSelectNone">Clear Selection</button></div><div id="fuBulkRecipients" style="max-height:260px;overflow:auto"></div><p id="fuBulkProgress" class="fu-status" aria-live="polite">No bulk follow-up started.</p><button type="button" id="fuBulkStart">Start Bulk Follow-up</button><button type="button" class="secondary" id="fuBulkNext" disabled>Open Next WhatsApp</button><button type="button" class="secondary" id="fuBulkReset">Reset</button>';
    card.appendChild(panel);
    renderBulkRecipients();
    byId("fuBulkSelectAll").onclick = () => { panel.querySelectorAll("[data-fu-bulk-id]").forEach(x => x.checked = true); renderBulkCountOnly(); };
    byId("fuBulkSelectNone").onclick = () => { panel.querySelectorAll("[data-fu-bulk-id]").forEach(x => x.checked = false); renderBulkCountOnly(); };
    byId("fuBulkRecipients").addEventListener("change", renderBulkCountOnly);
    byId("fuBulkStart").onclick = () => {
      const ids = [...panel.querySelectorAll("[data-fu-bulk-id]:checked")].map(x => x.dataset.fuBulkId);
      if (!ids.length) { say("Select at least one opted-in customer.", true); return; }
      if (!window.confirm("Start bulk follow-up for " + ids.length + " opted-in customers? Each WhatsApp message must still be reviewed and sent manually.")) return;
      FU_BULK = { ids, index: 0 };
      byId("fuBulkNext").disabled = false;
      byId("fuBulkProgress").textContent = "Ready: 0 / " + ids.length + " opened. Tap Open Next WhatsApp for each customer.";
    };
    byId("fuBulkNext").onclick = () => openNextBulkChat().catch(e => say(e.message || String(e), true));
    byId("fuBulkReset").onclick = () => { FU_BULK = { ids: [], index: 0 }; byId("fuBulkNext").disabled = true; byId("fuBulkProgress").textContent = "Bulk queue reset."; };
  }
  function renderBulkCountOnly() {
    const box = byId("fuBulkRecipients");
    if (box && byId("fuBulkCount")) byId("fuBulkCount").textContent = box.querySelectorAll("[data-fu-bulk-id]:checked").length + " selected · " + box.querySelectorAll("[data-fu-bulk-id]").length + " eligible";
  }
  async function openNextBulkChat() {
    if (FU_BULK.index >= FU_BULK.ids.length) { byId("fuBulkNext").disabled = true; byId("fuBulkProgress").textContent = "Completed: " + FU_BULK.ids.length + " WhatsApp chats opened. Send status is not confirmed by this page."; return; }
    const id = FU_BULK.ids[FU_BULK.index];
    const contact = FU.contacts.find(c => c.id === id);
    const message = byId("fuManualMessage").value.trim();
    if (!contact || !contact.whatsapp_opt_in || contact.do_not_contact) { FU_BULK.index++; byId("fuBulkProgress").textContent = "Skipped a contact whose consent is no longer active."; return; }
    if (!message) { say("Enter the bulk follow-up message first.", true); return; }
    const phone = normalizedPhone(contact.phone);
    if (phone.length < 10) { FU_BULK.index++; say("Skipped invalid phone number for " + contact.customer_name, true); return; }
    const opened = window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(message), "_blank", "noopener");
    if (!opened) { say("WhatsApp tab was blocked. Allow pop-ups and tap Open Next WhatsApp again.", true); return; }
    const { error } = await db.from("followup_logs").insert({ contact_id: contact.id, channel: "manual_bulk", recipient_phone: contact.phone, message_text: message, status: "opened", created_by: currentUser?.id || null });
    if (error) throw error;
    FU_BULK.index++;
    byId("fuBulkProgress").textContent = "Opened " + FU_BULK.index + " / " + FU_BULK.ids.length + ": " + contact.customer_name + ". Press Send in WhatsApp, then return here for the next customer.";
    if (FU_BULK.index >= FU_BULK.ids.length) byId("fuBulkNext").disabled = true;
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
      setupBulkFollowup();
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


/* GODAM STOCK — approved clean navy + gold professional template */
(function () {
  "use strict";
  const css = `
    #godamStockHub{--gs-navy:#082b55;--gs-navy2:#123d6d;--gs-gold:#d5aa55;--gs-line:#e3e9f1;--gs-muted:#68788b;background:#f8fafd!important;border:1px solid var(--gs-line)!important;border-top:4px solid var(--gs-gold)!important;border-radius:18px!important;padding:22px!important;color:#142b49!important}
    #godamStockHub>h2{font-size:25px!important;font-weight:800!important;letter-spacing:-.035em!important;color:var(--gs-navy)!important;margin:0 0 4px!important}
    #godamStockHub>h2:before{content:"PRAVEEN PHARMA  /  INVENTORY CONTROL";display:block;color:#9a762f;font-size:10px;letter-spacing:.16em;font-weight:800;margin-bottom:7px}
    #godamStockHub>p.muted{color:var(--gs-muted)!important;font-size:13px!important;margin:0 0 20px!important;max-width:850px}
    #godamStockHub>.panel{background:#fff!important;border:1px solid var(--gs-line)!important;border-radius:14px!important;box-shadow:0 5px 18px rgba(8,43,85,.045)!important;padding:18px!important;margin:0 0 20px!important}
    #godamStockHub h3{color:var(--gs-navy)!important;font-size:16px!important;font-weight:750!important;letter-spacing:-.01em}
    #godamStockHub input,#godamStockHub select,#godamStockHub textarea{background:#fff!important;color:#142b49!important;border:1px solid #d7e0eb!important;border-radius:9px!important;min-height:44px!important}
    #godamStockHub input:focus,#godamStockHub select:focus,#godamStockHub textarea:focus{border-color:var(--gs-gold)!important;box-shadow:0 0 0 3px #d5aa5526!important}
    #godamStockHub button{background:var(--gs-navy)!important;color:#fff!important;border:1px solid var(--gs-navy)!important;border-radius:9px!important;box-shadow:none!important;font-size:13px!important;font-weight:700!important;min-height:40px!important}
    #godamStockHub button:hover{background:var(--gs-navy2)!important;transform:translateY(-1px)}
    #godamStockHub button.secondary{background:#fff!important;color:var(--gs-navy)!important;border:1px solid #d7e0eb!important}
    #godamStockHub button.danger{background:#b42318!important;border-color:#b42318!important;color:#fff!important}
    #godamStockHub #uploadGodamStock{background:var(--gs-gold)!important;color:#172b42!important;border-color:var(--gs-gold)!important}
    #godamStockHub #godamStockListView{background:#fff;border:1px solid var(--gs-line);border-radius:14px;padding:18px;box-shadow:0 5px 18px rgba(8,43,85,.035)}
    #godamStockHub #godamStockListView>div:first-child{padding-bottom:10px;border-bottom:1px solid #edf1f5}
    #godamStockHub #godamSearch{margin:14px 0!important;background:#f9fbfd!important}
    #godamStockHub #godamStockList{color:#142b49!important}
    #godamStockHub #godamStockList .medicine{background:#fff;border:1px solid var(--gs-line)!important;border-radius:11px;padding:14px!important;margin:9px 0;box-shadow:0 2px 7px rgba(8,43,85,.035);grid-template-columns:minmax(0,1fr) auto!important}
    #godamStockHub #godamStockList .medicine:hover{border-color:#d5aa55!important;box-shadow:0 5px 14px rgba(8,43,85,.07)}
    #godamStockHub #godamStockEditView{background:#fff;border:1px solid var(--gs-line);border-radius:14px;padding:18px;margin-top:14px;box-shadow:0 5px 18px rgba(8,43,85,.04)}
    #godamStockHub #godamBackToList{margin:0 0 12px!important}
    #godamStockHub #godamDetailHeading{font-size:20px!important;padding:0 0 12px;border-bottom:2px solid #f0e5ca}
    #godamStockHub #godamStockEditor{color:#142b49!important}
    #godamStockHub #godamStockEditor>div{border-color:var(--gs-line)!important}
    #godamStockHub hr{border:0;border-top:1px solid var(--gs-line);margin:22px 0}
    #godamStockHub #godamStockCurrent{padding:12px 14px;background:#f5f8fc;border:1px solid var(--gs-line);border-radius:9px}
    #godamStockHub #godamStockStatus{display:block;padding:10px 12px;background:#f5f8fc;border:1px solid var(--gs-line);border-radius:9px}
    @media(max-width:600px){#godamStockHub{padding:14px!important;border-radius:13px!important}#godamStockHub>.panel,#godamStockHub #godamStockListView,#godamStockHub #godamStockEditView{padding:13px!important}#godamStockHub #godamStockList .medicine{grid-template-columns:1fr!important;gap:8px!important}}
  `;
  function apply() {
    if (document.getElementById("godamProfessionalTemplate")) return;
    const style = document.createElement("style");
    style.id = "godamProfessionalTemplate";
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
  else apply();
})();
