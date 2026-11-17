# PRAVEEN PHARMA — Full Pharma Platform Feature Parity

This is the implementation specification for the three connected PRAVEEN PHARMA websites. It is not a claim that every feature is already implemented.

## Product principles
- Build original PRAVEEN PHARMA UX inspired by common B2B pharma workflows; do not copy third-party branding, source code, or proprietary assets.
- Keep the Main Website, Retailer Portal, and Admin Dashboard visually consistent and responsive.
- Keep one Supabase backend and shared catalogue/order data.
- Preserve existing medicine records, uploaded image files, labels, authentication, and existing working order flows.
- Uploaded medicine photos must remain byte-for-byte unchanged; create 3D presentation using CSS only.
- Delivery charge is always ₹0. Keep delivery and shop-pickup options.
- GST invoice support remains enabled.
- Public visitors must not see retailer-only prices, GST/private terms, or private stock.
- Only Admin-approved companies and individually Admin-approved active medicines appear in the public catalogue.
- Only approved retailers may access retailer pricing and place orders.
- Admin privileges remain restricted to the configured Admin identity; never expose service-role secrets in browser code.

## Main Website — public storefront
- Professional home page, responsive navigation, search, company/category browsing.
- Approved company storefronts and approved medicine catalogue.
- Medicine detail view: original photo with CSS 3D display, name, composition, pack, category, availability status.
- Search by medicine/brand/composition; filters by company/category/pack.
- Compare products on safe public fields (name, composition, pack, company; no private pricing).
- Contact, about, announcements, policies, and shop details.
- Clear retailer login/register entry point.
- Public pricing only if explicitly enabled by Admin and safe to disclose.

## Retailer Portal — B2B purchasing
- Retailer registration, login, profile, GSTIN/business details, approval status.
- Search by brand, generic/composition, SKU and company; filters and product comparison.
- Approved company storefronts; seller/distributor-specific catalogue where configured.
- Retailer-specific prices, GST, schemes, discounts, stock visibility and minimum order quantities.
- Fast order / bulk order entry and draft cart.
- Cart, quantity editing, repeat order, saved/favourite products.
- Order placement, order history, status timeline, cancellation/request support subject to order status.
- Shortage book / unavailable-item request and substitute suggestions (suggestions require human confirmation; never auto-substitute).
- Invoice view/download and payment/ledger history when payment records are configured.
- Notifications for approval, order updates, shortages, offers and invoices.
- Delivery or shop pickup; delivery fee fixed at ₹0.

## Admin Dashboard — operations and controls
- Overview dashboard: catalogue, approved/pending retailers, orders, sales totals and operational alerts.
- Company create/edit/approve/publish/unpublish.
- Medicine create/edit, company assignment, image upload, individual approval/publish, active/inactive.
- Original-image preview; preserve uploaded file and label.
- Inventory: stock ledger, batch/expiry tracking, low-stock and near-expiry alerts.
- Retailer approvals, profile review, account status and retailer-specific price lists.
- Schemes/offers: date range, eligibility, company/product scope, quantity slabs, discount and active switch.
- Orders: review, accept/process/dispatch/ready-for-pickup/complete/cancel with audit history.
- GST invoice generation and invoice numbering; payment/ledger recording only with verified transaction data.
- Shortage book and substitute review.
- Reports: sales, orders, retailer activity, company/product performance, stock and expiry.
- Notifications/announcements, settings, activity log, login history, backup/export and health checks.
- Role-based access and audit logs for sensitive changes.

## Cross-platform advanced features
- Fast search with spelling-tolerant suggestions.
- Product comparison and favourites.
- Repeat last order and saved draft carts.
- Bulk upload/export with validation and duplicate detection.
- Multi-company / multi-supplier basket only where supplier and fulfilment rules are clear.
- Stock reservation and order validation to prevent overselling.
- Returns/shortage/damage claims with evidence and Admin decision.
- Price history and scheme history visible only to authorized users.
- In-app notification centre and optional email/WhatsApp integrations after credentials and consent are configured.
- Accessibility, mobile-first responsive UI, loading/empty/error states, and safe retry handling.

## Delivery phases and acceptance criteria
1. **Audit & foundation:** map existing tables, RLS, pages, and current flows. No existing records deleted.
2. **Catalogue & search:** common design system, storefronts, filters, comparison, favourites, fast order.
3. **Commerce:** cart, saved carts, repeat order, robust order status workflow, stock validation.
4. **Inventory & offers:** batch/expiry, stock ledger, shortage book, offers/schemes.
5. **Finance & communications:** GST invoices, payment ledger, notification centre, reports.
6. **QA & release:** test Admin, approved/unapproved retailer, anonymous visitor, mobile/desktop, RLS, image preservation, order edge cases.

Do not mark a phase complete until its database policies, UI wiring, and end-to-end tests all pass. A successful SQL migration alone does not prove frontend functionality.
