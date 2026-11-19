// Supabase Edge Function: medicine-photo-studio
// Required secrets: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const views=[
 {key:"combo",label:"Combo view",prompt:"Create a clean catalogue combo photograph: for a box-and-strip product show the box at upper left and main product on right-centre; show strip back vertically on right and strip front at bottom-left when both are visible in reference. For bottle/syrup/drop/tube/injection, show the exact container with its box only if present."},
 {key:"front",label:"Front close-up",prompt:"Create a close-up catalogue photograph of the FRONT face only, centred and straight-on."},
 {key:"back",label:"Back/details close-up",prompt:"Create a close-up of the BACK/details side only. Include only details actually visible in the reference; do not invent batch, MRP, expiry, manufacturer or barcode."},
 {key:"box",label:"Box alone",prompt:"Show ONLY the original medicine box, centred, front-facing, with the original box artwork."}
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
  const {data:admin}=await service.from("admin_users").select("role,is_active").eq("user_id",user.id).maybeSingle();
  if(!admin?.is_active||admin.role!=="owner")return reply({error:"Owner Admin access only"},403);
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
   const prompt="Use the uploaded medicine packaging photo as the ONLY source of truth. Product name: "+medicine_name.trim()+". Product type: "+product_type+". "+view.prompt+" Preserve the exact original package design, brand spelling, logo, colours, graphics, composition, pack size and all printed text. Do not redesign, recolour, beautify, replace, add or guess any wording or numbers. If text is too small or blurry, do not fabricate it; leave it faithful to the source and flag for human inspection. No invented batch number, MRP, expiry, barcode or manufacturer. Clean white or very light blue studio background, realistic high-resolution product catalogue photography, soft natural shadow. This is a draft for human review; packaging text fidelity is more important than visual polish.";
   const form=new FormData();form.append("model","gpt-image-2.5-sunburst");form.append("prompt",prompt);form.append("size","1024x1024");form.append("image[]",new File([source], "reference."+ext,{type:mime}));
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
