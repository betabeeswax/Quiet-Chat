import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return reply(405,{error:"Use POST."});
 try{
  const {username:rawUsername,password}=await req.json();
  const username=String(rawUsername??"").trim().toLowerCase();
  if(!/^[a-z0-9_-]{2,24}$/.test(username)) return reply(400,{error:"Username must be 2–24 characters using letters, numbers, _ or -."});
  if(typeof password!=="string"||password.length<8||password.length>128) return reply(400,{error:"Password must be at least 8 characters."});
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return reply(500,{error:"Username sign-up is not configured on the server."});
  const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:existing,error:lookupError}=await admin.from("profiles").select("id").ilike("username",username).limit(1).maybeSingle();
  if(lookupError) return reply(500,{error:"Could not check username availability."});
  if(existing) return reply(409,{error:"That username is already taken. Try another one."});
  const fakeEmail=username+"@username.quietchat.invalid";
  const {data:created,error:createError}=await admin.auth.admin.createUser({email:fakeEmail,password,email_confirm:true,user_metadata:{username,login_method:"username"}});
  if(createError||!created.user) return reply(409,{error:"Could not create that account. The username may already be taken."});
  const {error:registryError}=await admin.from("username_accounts").insert({username_key:username,user_id:created.user.id});
  if(registryError){await admin.auth.admin.deleteUser(created.user.id);return reply(409,{error:"That username is already taken. Try another one."});}
  const {error:profileError}=await admin.from("profiles").upsert({id:created.user.id,username,bio:""},{onConflict:"id"});
  if(profileError){await admin.from("username_accounts").delete().eq("user_id",created.user.id);await admin.auth.admin.deleteUser(created.user.id);return reply(500,{error:"Account setup failed. Please try again."});}
  return reply(200,{ok:true,email:fakeEmail});
 }catch{return reply(400,{error:"Invalid request."});}
});
