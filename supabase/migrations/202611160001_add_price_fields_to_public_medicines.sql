-- Add pricing and GST fields to the existing active-medicines view.
-- Existing medicine rows and prices are preserved.
create or replace view public.public_medicines as
select
  id,
  name,
  composition,
  pack_size,
  category,
  image_url,
  common_price,
  gst_rate
from public.medicines
where is_active = true;
