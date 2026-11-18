# Deploy medicine formula verification

The Admin page now calls the Supabase Edge Function named `medicine-formula-info`.

## Deploy from the Supabase Dashboard

1. Open the Supabase project connected to PRAVEEN PHARMA.
2. Open **Edge Functions** and choose **Deploy a new function** / **Via Editor**.
3. Set the function name to exactly `medicine-formula-info`.
4. Replace the starter code with the complete contents of `supabase/functions/medicine-formula-info/index.ts` from this repository.
5. Deploy the function. The function uses the Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables; do not put the service-role key in the website or GitHub.
6. Open the Admin page, go to **Existing medicines**, and click **Verify all active medicine formulas** (the button currently checks all medicines, including inactive ones).

## What it does

- Verifies each saved medicine against the US FDA's official drug-label database (openFDA).
- Saves only label fields actually present: mechanism/clinical pharmacology, indications/purpose, adverse reactions, warnings/precautions.
- Does not invent a separate “Benefits” claim; that field remains unavailable unless a trustworthy source explicitly supports it.
- Exact ingredient matches only. A missing match is left as **Not verified / unavailable**.
- A newly saved or edited medicine automatically triggers a fresh check.

## Important limitation

openFDA is an official US drug-label source, not a complete Indian medicine/brand database. Many Indian trade names and formulations will not match it. Such medicines remain unverified; a pharmacist must review a suitable Indian approved product insert or other authoritative source before adding claims. This function does not replace professional review.
