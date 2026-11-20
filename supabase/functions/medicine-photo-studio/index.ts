// Supabase Edge Function: medicine-photo-studio
// Required secrets: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
// Every view uses the uploaded photo as the packaging master. Only camera angle,
// product placement, lighting and shadow may change; unseen artwork must not be invented.
const views=[
 {key:"front-three-quarter",label:"3D Front — Left Angle",prompt:"Create a photorealistic 3D product render of the EXACT medicine pack shown in the reference, viewed from a gentle front-left three-quarter camera angle. Keep the original front artwork facing the camera and fully readable. Show believable package depth and a natural side edge, without inventing any side-panel text or graphics."},
 {key:"right-three-quarter",label:"3D Front — Right Angle",prompt:"Create a photorealistic 3D product render of the EXACT medicine pack shown in the reference, viewed from a gentle front-right three-quarter camera angle. Keep the original front artwork facing the camera and fully readable. Show believable package depth and a natural side edge, without inventing any side-panel text or graphics."},
 {key:"top-perspective",label:"3D Top Perspective",prompt:"Create a photorealistic 3D product render of the EXACT medicine pack shown in the reference from a slightly elevated front perspective. Show a subtle visible top edge and realistic thickness, while keeping the original front artwork, layout and text facing the camera and readable. Do not invent unseen printed details."},
 {key:"premium-hero",label:"Premium 3D Catalogue",prompt:"Create a premium studio hero render of the EXACT medicine pack shown in the reference, upright and slightly angled in a clean catalogue composition. Keep the original front artwork prominent, unchanged and readable. Use realistic depth, soft studio lighting and a natural grounded shadow; do not add props, extra products or new packaging artwork."}
];
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try{
  const auth=req.headers.get("Authorization")||"";
  const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
  const publishableKey=publishableKeys.default||Deno.env.get("SUPABASE_ANON_KEY");
  if(!publishableKey)return reply({error:"Supabase publishable key is not configured"},500);
  const userClient=createClient(Deno.env.get("SUPABASE_URL")!,publishableKey,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userErr}=await userClient.auth.getUser();
  if(userErr||!user)return reply({error:"Admin sign-in required"},401);
  const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
  const serviceKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceKey)return reply({error:"Supabase server secret key is not configured"},500);
  const service=createClient(Deno.env.get("SUPABASE_URL")!,serviceKey);
  const {data:admin,error:adminErr}=await userClient.from("admin_users").select("role,is_active").eq("user_id",user.id).maybeSingle();
  if(adminErr)return reply({error:"Could not verify Admin owner access: "+adminErr.message},500);
  if(!admin?.is_active||admin.role!=="owner")return reply({error:"Owner Admin access only (account role or active status mismatch)"},403);
  const {source_path,medicine_id,medicine_name,product_type="auto"}=await req.json();
  if(typeof source_path!=="string"||!source_path.startsWith("studio-originals/"+user.id+"/")||typeof medicine_id!=="string"||typeof medicine_name!=="string"||!medicine_name.trim())return reply({error:"A saved medicine, valid source path and medicine name are required"},400);
  const {data:medicine,error:medicineErr}=await service.from("medicines").select("id").eq("id",medicine_id).maybeSingle();
  if(medicineErr||!medicine)return reply({error:"The selected medicine record could not be found"},404);
  const apiKey=Deno.env.get("OPENAI_API_KEY");if(!apiKey)return reply({error:"AI generation is not configured yet. Add OPENAI_API_KEY as a Supabase Edge Function secret and deploy this function."},503);
  const {data:source,error:downloadErr}=await service.storage.from("medicine-images").download(source_path);
  if(downloadErr||!source)return reply({error:"Could not read the uploaded reference image"},400);
  const mime=source.type||"image/jpeg";const ext=mime.includes("png")?"png":mime.includes("webp")?"webp":"jpg";
  const saved=[];
  for(const view of views){
   const prompt="The uploaded photo is the master product reference. Make an EDIT of that exact photographed medicine package, not a newly designed medicine box. Medicine name: "+medicine_name.trim()+". Product type hint: "+product_type+" (auto means infer from the image). "+view.prompt+" NON-NEGOTIABLE PACKAGING MATCH: preserve the exact brand name and spelling, logo, typography, text, formula/composition, colours, colour blocks, illustrations, border lines, label layout, pack-size markings and every visible printed detail from the source. Do not retype, paraphrase, translate, replace, add, remove, recolour or redesign any visible artwork. Do not invent a back panel, batch, MRP, expiry, barcode, manufacturer details or any unseen writing. If a face is not visible in the reference, show only a plain realistic continuation of the package material/colour with no text or graphics. Keep the same physical package type and proportions; do not turn a bottle into a box or a strip into a carton. Only change the product's 3D pose/camera angle, placement, studio lighting, background and natural shadow. Use a uniform soft light-blue studio background close to #A8D0E8, realistic high-resolution commercial product photography, soft natural grounded shadow and balanced studio lighting. No extra objects, no duplicate packs, no watermark. This is a draft for human review; never sacrifice source artwork fidelity for a more dramatic angle.";
   const form=new FormData();form.append("model","gpt-image-2.5-sunburst");form.append("prompt",prompt);form.append("size","1024x1024");form.append("quality","high");form.append("image[]",new File([source],"reference."+ext,{type:mime}));
   const res=await fetch("https://api.openai.com/v1/images/edits",{method:"POST",headers:{Authorization:"Bearer "+apiKey},body:form});
   const data=await res.json();if(!res.ok)throw new Error(data.error?.message||"Image generation provider error");
   const b64=data.data?.[0]?.b64_json;if(!b64)throw new Error("Image provider returned no image data");
   const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const path="studio-generated/"+user.id+"/"+crypto.randomUUID()+"-"+view.key+".png";
   const {error:upErr}=await service.storage.from("medicine-images").upload(path,bytes,{contentType:"image/png",upsert:false});if(upErr)throw upErr;
   const {data:{publicUrl}}=service.storage.from("medicine-images").getPublicUrl(path);
   saved.push({key:view.key,label:view.label,path,url:publicUrl});
  }
  const {data:photoSet,error:insertErr}=await service.from("medicine_photo_studio").insert({admin_user_id:user.id,medicine_id,medicine_name:medicine_name.trim(),product_type,source_path,images:saved,status:"draft"}).select("id").single();
  if(insertErr)throw insertErr;
  return reply({status:"draft",photo_set_id:photoSet.id,images:saved});
 }catch(e){return reply({error:e?.message||"Unexpected generation error"},500);}
});
