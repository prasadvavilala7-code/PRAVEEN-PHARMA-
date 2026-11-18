-- PRAVEEN PHARMA: additive GST invoice support.
-- Preserves existing medicines, stock, orders, order items, accounts and photos.
begin;

alter table public.medicines add column if not exists hsn_code text not null default '';
alter table public.order_items add column if not exists hsn_code text not null default '';

create table if not exists public.retailer_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  retailer_user_id uuid not null references auth.users(id) on delete restrict,
  invoice_number text not null unique,
  invoice_date timestamptz not null default now(),
  invoice_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists retailer_invoices_owner_date_idx
  on public.retailer_invoices (retailer_user_id, invoice_date desc);
alter table public.retailer_invoices enable row level security;

drop policy if exists "Retailer reads own invoices" on public.retailer_invoices;
create policy "Retailer reads own invoices" on public.retailer_invoices
  for select to authenticated using (auth.uid() = retailer_user_id);
drop policy if exists "Configured admin manages invoices" on public.retailer_invoices;
create policy "Configured admin manages invoices" on public.retailer_invoices
  for all to authenticated
  using (auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid)
  with check (
    auth.uid() = '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid
    and created_by = auth.uid()
  );
grant select, insert, update, delete on public.retailer_invoices to authenticated;

create sequence if not exists public.retailer_invoice_number_seq;

create or replace function public.issue_retailer_gst_invoice(p_order_id text, p_seller jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
  v_profile public.retailer_profiles%rowtype;
  v_existing public.retailer_invoices%rowtype;
  v_items jsonb;
  v_snapshot jsonb;
  v_invoice_no text;
  v_fy text;
begin
  if auth.uid() is distinct from '9be3d5ee-e09a-4738-9b27-f2fae15e93c7'::uuid then
    raise exception 'Only the configured Admin can issue invoices';
  end if;
  if coalesce(p_seller->>'business_name','') = '' or coalesce(p_seller->>'address','') = '' then
    raise exception 'Seller business name and address are required';
  end if;
  if coalesce(p_seller->>'gstin','') !~ '^[0-9A-Z]{15}$' then
    raise exception 'A valid 15-character seller GSTIN is required';
  end if;

  select * into v_order from public.orders where id::text = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  select * into v_existing from public.retailer_invoices where order_id = p_order_id;
  if found then return to_jsonb(v_existing); end if;

  select * into v_profile from public.retailer_profiles where user_id = v_order.retailer_id;
  if not found then raise exception 'Retailer profile not found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'medicine_name', oi.medicine_name,
    'hsn_code', oi.hsn_code,
    'pack_size', oi.pack_size,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'gst_rate', oi.gst_rate,
    'tax_amount', round((oi.quantity * oi.unit_price * oi.gst_rate / 100)::numeric, 2),
    'line_total', round((oi.quantity * oi.unit_price * (1 + oi.gst_rate / 100))::numeric, 2)
  ) order by oi.medicine_name), '[]'::jsonb)
  into v_items
  from public.order_items oi where oi.order_id::text = p_order_id;

  if jsonb_array_length(v_items) = 0 then raise exception 'Order has no saved line items'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x
    where coalesce(x->>'hsn_code','') = ''
  ) then
    raise exception 'Enter HSN codes for every medicine before issuing a GST invoice';
  end if;

  v_fy := case
    when extract(month from now()) >= 4
      then to_char(now(),'YY') || '-' || to_char((extract(year from now())::int + 1) % 100,'FM00')
    else to_char((extract(year from now())::int - 1) % 100,'FM00') || '-' || to_char(now(),'YY')
  end;
  v_invoice_no := 'PP/' || v_fy || '/' ||
    lpad(nextval('public.retailer_invoice_number_seq')::text,6,'0');

  v_snapshot := jsonb_build_object(
    'seller', p_seller,
    'buyer', jsonb_build_object(
      'shop_name',v_profile.shop_name,
      'owner_name',v_profile.owner_name,
      'phone',v_order.phone,
      'city',v_order.city,
      'gstin',v_profile.gstin
    ),
    'items',v_items,
    'subtotal',coalesce(v_order.subtotal,0),
    'gst_amount',coalesce(v_order.gst_amount,0),
    'grand_total',coalesce(v_order.grand_total,0),
    'delivery_method',v_order.delivery_method,
    'delivery_charge',0,
    'tax_type',case
      when left(p_seller->>'gstin',2) = left(coalesce(v_profile.gstin,''),2)
        then 'CGST + SGST (same-state GSTIN)'
      else 'IGST (verify place of supply)'
    end
  );

  insert into public.retailer_invoices
    (order_id,retailer_user_id,invoice_number,invoice_snapshot,created_by)
  values
    (p_order_id,v_order.retailer_id,v_invoice_no,v_snapshot,auth.uid())
  returning * into v_existing;

  return to_jsonb(v_existing);
end;
$$;

revoke all on function public.issue_retailer_gst_invoice(text,jsonb) from public, anon;
grant execute on function public.issue_retailer_gst_invoice(text,jsonb) to authenticated;

commit;

-- Refresh PostgREST's schema cache so the admin/retailer pages can see hsn_code immediately.
notify pgrst, 'reload schema';
