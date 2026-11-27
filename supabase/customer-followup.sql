-- PRAVEEN PHARMA Customer Follow-up module
-- Additive only: does not modify or delete existing customer, order, medicine, or login data.

create table if not exists public.followup_settings (
  id boolean primary key default true check (id = true),
  automatic_enabled boolean not null default false,
  manual_enabled boolean not null default true,
  schedule_days integer[] not null default array[7,15,30],
  timezone text not null default 'Asia/Kolkata',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint followup_days_valid check (
    cardinality(schedule_days) between 1 and 10
    and array_position(schedule_days, null) is null
    and 0 < all (schedule_days)
    and 365 >= all (schedule_days)
  )
);

create table if not exists public.followup_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  shop_name text,
  phone text not null,
  phone_normalized text not null unique,
  source text not null default 'manual' check (source in ('manual','order_import','retailer')),
  whatsapp_opt_in boolean not null default false,
  consent_source text,
  consent_at timestamptz,
  do_not_contact boolean not null default false,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followup_phone_digits check (phone_normalized ~ '^[0-9]{10,15}$'),
  constraint followup_consent_consistent check (
    (whatsapp_opt_in = false) or (consent_at is not null and consent_source is not null)
  )
);

create table if not exists public.followup_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body text not null,
  meta_template_name text,
  language_code text not null default 'en',
  meta_approved boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.followup_schedule (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.followup_contacts(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  template_id uuid references public.followup_templates(id) on delete set null,
  channel text not null default 'automatic' check (channel in ('automatic','manual')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','paused','sent','failed','cancelled')),
  message_override text,
  idempotency_key text unique,
  attempts integer not null default 0,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.followup_logs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.followup_contacts(id) on delete set null,
  schedule_id uuid references public.followup_schedule(id) on delete set null,
  channel text not null check (channel in ('automatic','manual')),
  recipient_phone text not null,
  message_text text not null,
  status text not null check (status in ('opened','sent','delivered','read','failed')),
  provider_message_id text,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists followup_contacts_phone_idx on public.followup_contacts(phone_normalized);
create index if not exists followup_schedule_due_idx on public.followup_schedule(status, channel, scheduled_for);
create index if not exists followup_schedule_contact_idx on public.followup_schedule(contact_id, scheduled_for desc);
create index if not exists followup_logs_created_idx on public.followup_logs(created_at desc);
create index if not exists orders_followup_created_idx on public.orders(created_at desc);

alter table public.followup_settings enable row level security;
alter table public.followup_contacts enable row level security;
alter table public.followup_templates enable row level security;
alter table public.followup_schedule enable row level security;
alter table public.followup_logs enable row level security;

drop policy if exists followup_settings_admin_all on public.followup_settings;
create policy followup_settings_admin_all on public.followup_settings
  for all to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin());

drop policy if exists followup_contacts_admin_all on public.followup_contacts;
create policy followup_contacts_admin_all on public.followup_contacts
  for all to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin());

drop policy if exists followup_templates_admin_all on public.followup_templates;
create policy followup_templates_admin_all on public.followup_templates
  for all to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin());

drop policy if exists followup_schedule_admin_all on public.followup_schedule;
create policy followup_schedule_admin_all on public.followup_schedule
  for all to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin());

drop policy if exists followup_logs_admin_all on public.followup_logs;
create policy followup_logs_admin_all on public.followup_logs
  for all to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin());

grant select, insert, update, delete on public.followup_settings to authenticated;
grant select, insert, update, delete on public.followup_contacts to authenticated;
grant select, insert, update, delete on public.followup_templates to authenticated;
grant select, insert, update, delete on public.followup_schedule to authenticated;
grant select, insert, update, delete on public.followup_logs to authenticated;

insert into public.followup_settings (id)
values (true)
on conflict (id) do nothing;

grant select, insert, update, delete on public.followup_settings to service_role;
grant select, insert, update, delete on public.followup_contacts to service_role;
grant select, insert, update, delete on public.followup_templates to service_role;
grant select, insert, update, delete on public.followup_schedule to service_role;
grant select, insert, update, delete on public.followup_logs to service_role;
