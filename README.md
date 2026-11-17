# PRAVEEN-PHARMA-
PRAVEEN PHARMA Medicine Ordering Website

## Retailer Operations & Central Order Hub migration

New additive SQL file: `supabase/retailer-operations-hub.sql`.

Before running it:
1. Open the correct PRAVEEN PHARMA Supabase project and go to **SQL Editor**.
2. Review the complete SQL file in this repository.
3. Confirm the existing `retailer_profiles` table and its `user_id` / `approval_status` columns are present.
4. Run the SQL once. It uses `CREATE TABLE IF NOT EXISTS`, adds indexes and RLS policies, and does not drop or rewrite existing stock, medicines, retailer profiles, orders, order items, accounts, or photos.
5. Verify the four new tables: `retailer_shortage_book`, `retailer_ledger_entries`, `retailer_invoices`, and `external_order_intake`.

Security and integration notes:
- Retailers can manage only their own shortage-book rows when approved.
- Retailers can read only their own ledger entries and invoices. Ledger and invoice records are Admin-managed.
- External platform order intake is deliberately not open to browser clients. A secure Supabase Edge Function using server-side service-role credentials is required, plus official partner/API approval. Never put a service-role key in website JavaScript.
- The migration creates the data layer only. The retailer/admin screens and invoice-generation workflow must be connected and tested before these features are described as live.
- Keep the existing `master-control-system.sql` and `company-approval-workflow.sql` setup intact. Do not rerun unrelated migrations as a shortcut.
