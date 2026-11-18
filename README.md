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


## GST invoice and HSN setup

The Admin order hub now has a **Generate GST Invoice** action. Before issuing a tax invoice:

1. Open the correct Supabase project and run `supabase/gst-invoice-support.sql` once in SQL Editor. This additive migration adds HSN fields, a protected invoice table, a sequential invoice number and an Admin-only invoice RPC. It does not delete or rewrite existing orders, stock, medicines, photos or accounts.
2. In Admin → Master Website Settings, enter the seller's valid 15-character GSTIN and save.
3. Edit each medicine and enter its correct HSN code and GST rate. Existing orders created before the migration have no saved HSN; they must be reviewed and corrected before an invoice can be issued.
4. In Admin → Central Order Hub, choose **Generate GST Invoice**. The invoice is stored as a frozen order snapshot and can be printed or saved as PDF.

The browser UI falls back to the old catalogue/order-item shape while the HSN migration is pending, so existing catalogue browsing and order placement remain available. Invoice issuance stays unavailable until the SQL migration and valid seller GSTIN/medicine HSN data are configured. Confirm GST classification, place of supply and invoice compliance with your GST accountant before issuing invoices.
