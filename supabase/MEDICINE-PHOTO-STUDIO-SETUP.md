# AI Medicine Photo Studio — setup

This is an additive Admin-only tool. Existing medicine records and photo URLs are not overwritten.

## 1. Apply the database migration
Open the PRAVEEN PHARMA Supabase project → SQL Editor. Review and run `supabase/medicine-photo-studio.sql` once.

## 2. Deploy the Edge Function
Deploy `supabase/functions/medicine-photo-studio/index.ts` as the function named `medicine-photo-studio`.

Set these Edge Function secrets in Supabase:
- `OPENAI_API_KEY` — API key for image generation (billing/usage may apply).
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-side secret only; never add this to website JavaScript.

The function uses OpenAI image edits with the uploaded source image as the reference. It generates four separate draft views. Tiny package text can still be distorted by image generation; manual comparison and approval are mandatory.

## 3. Open the Admin tool
After deployment, sign in using the existing owner Admin account at:
`https://prasadvavilala7-code.github.io/PRAVEEN-PHARMA-/photo-studio.html`

Upload a reference image, enter the exact medicine name, generate, inspect all four views and approve only if every visible detail matches. Approval records the review state; it does not automatically replace a live catalogue photo. Existing photos remain untouched.

## Important
- Storage bucket `medicine-images` must already exist and allow the authenticated owner Admin to upload, as in the current Admin photo workflow.
- If generated image files must be public on the catalogue, the existing bucket's public-read setting must be enabled. Do not make private medicine or customer data public.
- The website UI is not a substitute for checking the physical pack. Never rely on generated images for medicine identity, dosage or regulatory labelling.
