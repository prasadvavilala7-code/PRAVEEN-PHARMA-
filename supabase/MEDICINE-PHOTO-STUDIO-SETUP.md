# AI Medicine Photo Studio — setup and deployment status

This is an additive, owner-Admin-only workflow. Existing medicine records and existing photo URLs are not overwritten.

## Current project setup
- Supabase project: PRAVEEN PHARMA (`hdoftqemjttaegkysjyq`)
- Database table `public.medicine_photo_studio`: applied.
- Edge Function `medicine-photo-studio`: deployed and ACTIVE.
- Storage bucket `medicine-images`: already exists and is public. Existing upload policy is restricted to the configured owner Admin.
- Remaining prerequisite for image generation: set the `OPENAI_API_KEY` Edge Function secret.

## Add the OpenAI API key
1. Open [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/hdoftqemjttaegkysjyq/functions/secrets).
2. Add a secret named `OPENAI_API_KEY` with the API key from your OpenAI API account.
3. Save it. Supabase Edge Function secrets become available without redeploying.
4. Never paste this secret into the website, GitHub, or a chat message.

Supabase provides `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, and `SUPABASE_SECRET_KEYS` to hosted Edge Functions by default. The function uses the publishable key for user authentication and the server secret only inside the function.

## Open the Admin tool
After the website changes are published, sign in to `admin.html` with the existing owner Admin account. Open the medicine editor, upload the original product photo, then use **Smart AI Catalogue Photo Studio** in the Medicine photo section. There is no separate `photo-studio.html` page.

## Workflow
1. Upload one clear medicine packaging reference photo.
2. Enter the exact medicine name printed on the pack.
3. Choose a product type or leave auto-detect selected.
4. Generate four separate draft views: combo, front close-up, back/details close-up, and box alone.
5. Compare every image with the original pack and approve only if the visible details match.

## Important accuracy and safety limits
Image generation can distort small printed text, logos, batch numbers, MRP, expiry and barcodes. A prompt cannot guarantee exact packaging text. Never use generated artwork as the source of truth for medicine identity, composition, dosage, batch or expiry. Reject any image with altered or unreadable text. Approval links the generated catalogue views to the medicine while retaining the original upload in its gallery. Public visibility still follows the medicine's separate Admin publication/approval controls; photo approval alone does not publish a medicine.

The image-edit function uses `gpt-image-2.5-sunburst` with the uploaded photo as its reference. API usage may incur charges on the OpenAI API account.
