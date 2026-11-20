alter table public.order_items add column if not exists strip_quantity integer not null default 0;
alter table public.order_items drop constraint if exists order_items_strip_quantity_nonnegative;
alter table public.order_items add constraint order_items_strip_quantity_nonnegative check (strip_quantity >= 0);
comment on column public.order_items.strip_quantity is 'Retailer-entered strip count for display/fulfilment only; does not affect unit price, subtotal, GST, or grand total.';