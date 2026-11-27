# PRAVEEN PHARMA Customer Follow-up

This is an additive Admin module. Existing login, dashboard, medicine catalogue, orders and customer data are not removed or rewritten.

## Admin menu

A single **Follow-up** item opens seven separate sections:
- Customer List
- Follow-up Schedule
- Message Templates
- Automatic Follow-up
- Manual Follow-up
- Follow-up History
- Follow-up Settings

## Database

Run `supabase/customer-followup.sql` once in the **PRAVEEN PHARMA** Supabase project's SQL Editor. It creates five new tables, enables RLS, and restricts all five tables to active Admin users using the existing `private.is_active_admin()` helper. Existing order/customer tables are read only by the UI and are not modified.

Customer imports from Orders start with WhatsApp consent OFF. Only enable consent after the customer has explicitly agreed. Revoking consent blocks further follow-ups.

## Manual WhatsApp

The Manual Follow-up screen opens a WhatsApp click-to-chat link with the prepared message. The Admin must review and press **Send** in WhatsApp. The History status `opened` means the chat was opened; it does not claim that WhatsApp delivered the message.

## Automatic WhatsApp

Automatic sending uses the Supabase Edge Function `whatsapp-followup` and the official WhatsApp Business Cloud API. It only sends to contacts with `whatsapp_opt_in = true` and `do_not_contact = false`.

### Required Edge Function secrets

Set these in Supabase Dashboard → Edge Functions → Secrets:

- `FOLLOWUP_CRON_SECRET`: a long random secret you generate; use the same value in Supabase Vault for the scheduled request.
- `META_WA_ACCESS_TOKEN`: Meta WhatsApp Cloud API access token.
- `META_WA_PHONE_NUMBER_ID`: the sending WhatsApp Business phone-number ID.
- `META_WA_GRAPH_VERSION`: the current Graph API version supported by your Meta app (format `vNN.N`).

The Supabase Edge Function runtime provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never place Meta tokens or the service-role key in browser JavaScript or database tables.

### Meta message template

Create and get approval for a WhatsApp Utility template in Meta. The implementation passes the editable Admin message as the single body variable `{{1}}`. Therefore the approved template must contain exactly one body placeholder, for example:

`PRAVEEN PHARMA: {{1}}`

In Admin → Follow-up → Message Templates, enter the exact approved Meta template name and language, then mark it approved only after Meta approval is visible in WhatsApp Manager. Editing the message text in Admin does not edit or re-approve the Meta template itself.

### Schedule the dispatcher

Enable the `pg_cron` and `pg_net` extensions if they are not already enabled. Store the same `FOLLOWUP_CRON_SECRET` in Supabase Vault under the name `FOLLOWUP_CRON_SECRET`, then schedule the function every five minutes using the Supabase SQL Editor:

```sql
select cron.schedule(
  'praveen-pharma-whatsapp-followup',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://hdoftqemjttaegkysjyq.supabase.co/functions/v1/whatsapp-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-followup-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets
       where name = 'FOLLOWUP_CRON_SECRET' limit 1)
    ),
    body := jsonb_build_object('action', 'dispatch')
  );
  $job$
);
```

If your project uses a different extension schema, check the extension installation details before running the schedule SQL. Do not paste real API tokens into this repository or chat.

## Important behavior

- Automatic reminders are generated from recent orders only when Automatic Follow-up is enabled and the matching customer has opted in.
- Default intervals are 7, 15 and 30 days. Admin can change these in Follow-up Settings.
- A customer opt-out / revoked consent prevents dispatch.
- The dispatcher runs every five minutes, creates idempotent order reminders and sends due reminders using an active Meta-approved template.
- Manual WhatsApp is click-to-chat; the Admin must press Send.
- Automatic API messages are marked sent when Meta accepts the API request. Delivery/read receipts require a separate WhatsApp webhook integration and are not claimed by this first version.
