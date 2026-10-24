/* QuietChat — plain JavaScript + Supabase.
   Put your Supabase Project URL and publishable (or legacy anon) key below.
   Never put a service_role key in browser code. */
const SUPABASE_URL = "https://zdmkuookuljcintzgzrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eIjdkSKcO53agFW0J26A5Q_ENp_-m32";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const $ = (id) => document.getElementById(id);
let db, user, username = "", activeChat = null, chats = [], messageChannel = null, listChannel = null, messageRefreshTimer = null, toastTimer, authMode = "signin", usernameAuthMode = "signin", mediaRecorder = null, recordingChunks = [], recordingChatId = null, lastRenderedDay = "";

const setup = $("setup-screen"), app = $("app-screen");
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2800); }
function showSetup(needsProfile=false){setup.classList.remove("hidden");app.classList.add("hidden");$("auth-options").classList.toggle("hidden",needsProfile);$("profile-setup").classList.toggle("hidden",!needsProfile);}
function showApp(){setup.classList.add("hidden");app.classList.remove("hidden");$("account-label").textContent=user?.is_anonymous?"Guest account":(user?.email||"Signed-in account");}
function setAuthMode(mode){authMode=mode;const signingUp=mode==="signup";$("signup-username-wrap").classList.toggle("hidden",!signingUp);$("signup-username").required=signingUp;$("email-submit-btn").textContent=signingUp?"Create account →":"Sign in →";$("auth-switch-copy").textContent=signingUp?"Already have an account?":"New to QuietChat?";$("auth-mode-btn").textContent=signingUp?"Sign in":"Create an account";$("auth-password").autocomplete=signingUp?"new-password":"current-password";}
function setUsernameAuthMode(mode){usernameAuthMode=mode;const signingUp=mode==="signup";$("username-auth-submit").textContent=signingUp?"Create username account →":"Sign in with username →";$("username-auth-password").autocomplete=signingUp?"new-password":"current-password";$("username-auth-password").minLength=8;$("username-auth-switch-copy").textContent=signingUp?"Already have a username account?":"New here without an email?";$("username-auth-mode-btn").textContent=signingUp?"Sign in":"Create username account";}
function cleanName(s){return s.trim().replace(/\s+/g," ").slice(0,24);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function initials(s){return (s||"?").trim().slice(0,1).toUpperCase();}
function niceTime(s){return new Date(s).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});}
function linkifyText(text,parent){const re=/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;let cursor=0,m;while((m=re.exec(text))){parent.append(document.createTextNode(text.slice(cursor,m.index)));const raw=m[0],clean=raw.replace(/[),.!?;:]+$/g,"");if(clean){const a=document.createElement("a");a.href=clean.startsWith("www.")?"https://"+clean:clean;a.textContent=clean;a.target="_blank";a.rel="noopener noreferrer";parent.append(a);}parent.append(document.createTextNode(raw.slice(clean.length)));cursor=m.index+raw.length;}parent.append(document.createTextNode(text.slice(cursor)));}
const MEDIA_DB_NAME="quietchat-local-media-v1";
function openMediaDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(MEDIA_DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("media"))r.result.createObjectStore("media",{keyPath:"id"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function localMediaGet(id){const d=await openMediaDB();return new Promise((resolve,reject)=>{const r=d.transaction("media","readonly").objectStore("media").get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
const MEDIA_SAVE_KEY="quietchat-media-save-mode-v1";
function getMediaSaveMode(){return localStorage.getItem(MEDIA_SAVE_KEY)||"auto";}
async function localMediaDelete(id){const d=await openMediaDB();return new Promise((resolve,reject)=>{const tx=d.transaction("media","readwrite");tx.objectStore("media").delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function purgeExpiredLocalMedia(){if(getMediaSaveMode()!=="day")return;const items=await listLocalMediaRaw();const now=Date.now();for(const item of items){const saved=Number(item.saved_at)||new Date(item.created_at).getTime();if(now-saved>24*60*60*1000)await localMediaDelete(item.id);}}
async function localMediaSave(record){const d=await openMediaDB();return new Promise((resolve,reject)=>{const tx=d.transaction("media","readwrite");tx.objectStore("media").put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function cacheMedia(m,url){try{const mode=getMediaSaveMode();if(mode==="none")return;if(await localMediaGet(m.id))return;const response=await fetch(url);if(!response.ok)return;await localMediaSave({id:m.id,chat_id:m.chat_id,created_at:m.created_at,saved_at:Date.now(),type:m.attachment_type,name:m.attachment_name||"Attachment",blob:await response.blob()});}catch(e){console.warn("Local archive could not save media",e);}}
async function listLocalMediaRaw(){const d=await openMediaDB();return new Promise((resolve,reject)=>{const r=d.transaction("media","readonly").objectStore("media").getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
async function listLocalMedia(){await purgeExpiredLocalMedia();return (await listLocalMediaRaw()).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));}
async function showLocalGallery(){const root=$("gallery-grid");root.replaceChildren();$("media-save-mode").value=getMediaSaveMode();try{const items=await listLocalMedia();if(!items.length){root.textContent=getMediaSaveMode()==="none"?"Automatic saving is off. Change the setting to Auto or Save for a day to archive media you view.":"Photos and videos you open will be saved here on this browser. Nothing has been archived yet.";openDialog("gallery-dialog");return;}for(const item of items){const card=document.createElement("div");card.className="gallery-card";const url=URL.createObjectURL(item.blob);if(item.type==="image"){const img=document.createElement("img");img.src=url;img.alt=item.name;card.append(img);}else if(item.type==="video"){const v=document.createElement("video");v.src=url;v.controls=true;card.append(v);}else{const a=document.createElement("a");a.href=url;a.textContent="📎 "+item.name;a.target="_blank";card.append(a);}const date=document.createElement("small");date.textContent=new Date(item.created_at).toLocaleString();const save=document.createElement("a");save.href=url;save.download=item.name||"quietchat-media";save.textContent="Save to computer";card.append(date,save);root.append(card);}openDialog("gallery-dialog");}catch(e){toast("Couldn't open local media library in this browser.");}}
function showMessageNotification(m){if(!m||m.sender_id===user?.id||!document.hidden)return;if(localStorage.getItem("quietchat-notifications-enabled")!=="yes")return;const body=m.attachment_type?`Sent a ${m.attachment_type}.`:String(m.body||"New message").slice(0,120);if("Notification" in window&&Notification.permission==="granted"){try{new Notification(activeChat?.title||"New QuietChat message",{body,tag:"quietchat-"+m.id});}catch{}}}
function checkFirstWarning(){if(!localStorage.getItem("quietchat-warning-accepted-v1"))openDialog("safety-warning-dialog");}

function setProfile(name){username=name;$("my-name").textContent=name;$("my-avatar").textContent=initials(name);}
function openDialog(id){$(id).showModal();}
function scrollMessagesToBottom(){const area=$("messages");if(!area)return;requestAnimationFrame(()=>{area.scrollTop=area.scrollHeight;requestAnimationFrame(()=>{area.scrollTop=area.scrollHeight;});});}
function closeDialog(id){$(id).close();}

async function start(){
  if(!configured){$("config-warning").classList.remove("hidden");return;}
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  const {data,error}=await db.auth.getSession();
  if(error){toast(error.message);return;}
  if(data.session){user=data.session.user;await loadProfile();} else showSetup(false);
  setAuthMode("signin");setUsernameAuthMode("signin");checkFirstWarning();
}
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("username,bio,avatar_path").eq("id",user.id).maybeSingle();
  if(error){toast("Could not load your profile: "+error.message);user=null;showSetup(false);return;}
  if(data?.username){setProfile(data.username);window.myProfile=data;$("profile-bio").value=data.bio||"";if(data.avatar_path)await showAvatar(data.avatar_path);showApp();await loadChats();subscribeChatList();}
  else {showSetup(true);$("username").focus();}
}
$("auth-mode-btn").addEventListener("click",()=>setAuthMode(authMode==="signin"?"signup":"signin"));
$("google-signin-btn").addEventListener("click",async()=>{
  const {error}=await db.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin}});
  if(error)toast("Google sign-in failed: "+error.message);
});
$("email-auth-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!configured)return;
  const email=$("auth-email").value.trim(),password=$("auth-password").value;
  $("email-submit-btn").disabled=true;
  try{
    if(authMode==="signup"){
      const name=cleanName($("signup-username").value);
      if(name.length<2){toast("Choose a username with at least 2 characters.");return;}
      const {data,error}=await db.auth.signUp({email,password,options:{data:{username:name},emailRedirectTo:window.location.origin}});
      if(error){toast(error.message);return;}
      if(data.session&&data.user){user=data.user;const {error:saveError}=await db.from("profiles").upsert({id:user.id,username:name,bio:""},{onConflict:"id"});if(saveError){toast("Account made, but username save failed: "+saveError.message);return;}setProfile(name);window.myProfile={username:name,bio:"",avatar_path:null};showApp();await loadChats();subscribeChatList();}
      else toast("Account created! Check your email to confirm it, then sign in.");
    }else{
      const {data,error}=await db.auth.signInWithPassword({email,password});
      if(error){toast(error.message);return;}
      user=data.user;await loadProfile();
    }
  }finally{$("email-submit-btn").disabled=false;}
});
$("username-auth-mode-btn").addEventListener("click",()=>setUsernameAuthMode(usernameAuthMode==="signin"?"signup":"signin"));
$("username-auth-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!configured)return;
  const name=$("username-auth-name").value.trim().toLowerCase(),password=$("username-auth-password").value;
  if(!/^[a-z0-9_-]{2,24}$/.test(name)){toast("Use 2–24 letters, numbers, underscores or hyphens for your username.");return;}
  if(password.length<8){toast("Use a password with at least 8 characters.");return;}
  const button=$("username-auth-submit");button.disabled=true;
  try{
    const email=name+"@username.quietchat.invalid";
    if(usernameAuthMode==="signup"){
      const {data:created,error:createError}=await db.functions.invoke("username-signup",{body:{username:name,password}});
      if(createError){let message=createError.message;try{const body=await createError.context?.json?.();if(body?.error)message=body.error;}catch{}toast(message||"Could not create username account.");return;}
      if(created?.error){toast(created.error);return;}
    }
    const {data,error}=await db.auth.signInWithPassword({email,password});
    if(error){toast(usernameAuthMode==="signup"?"Account created, but sign-in failed. Try signing in with your username.":"Username or password is incorrect.");return;}
    user=data.user;await loadProfile();
  }finally{button.disabled=false;}
});
$("guest-signin-btn").addEventListener("click",async()=>{try{const {data,error}=await db.auth.signInAnonymously();if(error){toast("Guest sign-in failed. Enable Anonymous Sign-Ins in Supabase Auth.");return;}user=data.user;showSetup(true);$("username").focus();}catch(e){toast("Guest sign-in failed. Please try again.");}});
$("profile-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!configured)return;
  const name=cleanName($("username").value);if(name.length<2){toast("Use at least 2 characters.");return;}
  if(!user){const {data,error}=await db.auth.signInAnonymously();if(error){toast("Guest sign-in failed. Enable Anonymous Sign-Ins in Supabase Auth.");return;}user=data.user;}
  const {error:saveError}=await db.from("profiles").upsert({id:user.id,username:name,bio:""},{onConflict:"id"});
  if(saveError){toast("Could not save username: "+saveError.message);return;}
  setProfile(name);showApp();await loadChats();subscribeChatList();
});
async function loadChats(){
  if(!db||!user){toast("Please sign in again to load chats.");return;}
  // Keep this query simple: nested profiles joins can fail when the Supabase
  // relationship cache has not refreshed after a database setup change.
  const {data,error}=await db.from("chat_members")
    .select("chat_id,chats(id,name,created_at,is_public,description,allow_gifs,remove_inactive,created_by)")
    .eq("user_id",user.id);
  if(error){console.error("QuietChat loadChats membership query failed:",error);toast("Couldn't load chats: "+error.message);return;}
  const rows=data||[];
  const ids=[...new Set(rows.map(r=>r.chat_id))];
  const {data:memberships,error:membersError}=ids.length
    ? await db.from("chat_members").select("chat_id,user_id").in("chat_id",ids)
    : {data:[],error:null};
  if(membersError){console.error("QuietChat loadChats members query failed:",membersError);toast("Chats found, but members couldn't load: "+membersError.message);return;}
  const userIds=[...new Set((memberships||[]).map(m=>m.user_id))];
  const {data:profiles,error:profilesError}=userIds.length
    ? await db.from("profiles").select("id,username,avatar_path,bio").in("id",userIds)
    : {data:[],error:null};
  if(profilesError){console.error("QuietChat loadChats profiles query failed:",profilesError);toast("Chats found, but usernames couldn't load: "+profilesError.message);return;}
  const profileById=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
  const membersByChat={};
  (memberships||[]).forEach(m=>{(membersByChat[m.chat_id] ||= []).push({...m,profiles:profileById[m.user_id]||null});});
  window.chatProfileLookup={};
  chats=rows.map(row=>{
    const chat=row.chats||{};
    const allMembers=membersByChat[row.chat_id]||[];
    const members=allMembers.filter(m=>m.user_id!==user.id);
    const memberCount=allMembers.length||1;
    const other=members[0]?.profiles?.username||"Waiting for friend";
    if(members[0]?.profiles)window.chatProfileLookup[row.chat_id]=members[0].profiles;
    return {id:row.chat_id,created_at:chat.created_at,title:chat.name||other,memberCount,isGroup:Boolean(chat.name),bio:members[0]?.profiles?.bio||"",isPublic:!!chat.is_public,description:chat.description||"",allowGifs:chat.allow_gifs!==false,removeInactive:chat.remove_inactive!==false,createdBy:chat.created_by,memberNames:allMembers.map(m=>m.profiles?.username).filter(Boolean)};
  });
  renderChats();
  // Restore the last conversation this account used, instead of opening the first/top chat.
  if(!activeChat && chats.length){
    let remembered="";
    try{remembered=localStorage.getItem("quietchat-last-chat-"+user.id)||"";}catch{}
    const last=chats.find(c=>c.id===remembered);
    if(last) await selectChat(last);
  }
  await handleCallDeepLink();
}
function rowProfileForChat(chatId){return window.chatProfileLookup?.[chatId]||null;}
function renderChats(){
  const list=$("chat-list");list.replaceChildren();
  if(!chats.length){const d=document.createElement("div");d.className="empty-small";d.textContent="No chats yet. Create an invite or join a friend.";list.append(d);return;}
  chats.forEach(chat=>{
    const b=document.createElement("button");b.className="chat-item"+(activeChat?.id===chat.id?" active":"");
    const av=document.createElement("div");av.className="avatar";av.textContent=initials(chat.title);
    const t=document.createElement("div");t.className="chat-item-text";
    const strong=document.createElement("strong");strong.textContent=chat.title;
    const preview=document.createElement("span");preview.className="preview";preview.textContent=chat.isGroup?`${chat.memberCount} members · Group chat`:chat.memberCount<2?"Invite sent · waiting to join":"Private conversation";
    t.append(strong,preview);b.append(av,t);b.dataset.chatId=chat.id;b.addEventListener("click",()=>selectChat(chat));list.append(b);
    const memberData=rowProfileForChat(chat.id);
    if(memberData?.avatar_path){db.storage.from("profile-pics").createSignedUrl(memberData.avatar_path,3600).then(({data,error})=>{if(!error&&data?.signedUrl){const img=document.createElement("img");img.src=data.signedUrl;img.alt="";img.className="profile-avatar-img";av.replaceChildren(img);}});}
  });
}
async function selectChat(chat){
  activeChat=chat;try{localStorage.setItem("quietchat-last-chat-"+user.id,chat.id);}catch{};$("app-screen").classList.add("chat-open");$("chat-title").textContent=chat.title;$("chat-subtitle").textContent=chat.isGroup?`${chat.memberCount} members${chat.memberNames?.length?" · "+chat.memberNames.join(", "):""} · Messages are live`:(chat.bio||"Private chat · messages are live");$("chat-avatar").textContent=chat.isGroup?"👥":initials(chat.title);
  $("welcome-panel").classList.add("hidden");$("messages").classList.remove("hidden");$("composer-wrap").classList.remove("hidden");$("call-btn").disabled=false;$("settings-export-btn").disabled=false;$("game-btn").disabled=false;$("add-people-btn").classList.toggle("hidden",!chat.isGroup);$("add-people-btn").disabled=false;$("group-settings-btn")?.classList.toggle("hidden",!chat.isGroup);renderChats();
  requestAnimationFrame(()=>{const item=$(`chat-list`).querySelector(`[data-chat-id="${CSS.escape(chat.id)}"]`);item?.scrollIntoView({block:"nearest"});});
  if(messageChannel){db.removeChannel(messageChannel);messageChannel=null;}
  if(messageRefreshTimer){clearInterval(messageRefreshTimer);messageRefreshTimer=null;}
  // Realtime gives instant updates when enabled by the Supabase project.
  // Polling below is a fallback so new messages still appear without refreshing the page.
  lastRenderedDay="";
  const selectedChatId=chat.id;
  messageChannel=db.channel("messages-"+chat.id)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"chat_id=eq."+chat.id},payload=>{
      if(activeChat?.id!==selectedChatId)return;
      const exists=$("messages").querySelector(`[data-message-id="${CSS.escape(payload.new.id)}"]`);
      if(!exists)showMessageNotification(payload.new);
      renderMessage(payload.new);
    })
    .subscribe();
  await loadMessages();
  // Poll the newest messages every 2.5 seconds as a reliable fallback for missed realtime events.
  messageRefreshTimer=setInterval(()=>refreshActiveChatMessages(selectedChatId),2500);
}
async function refreshActiveChatMessages(chatId){
  if(!db||!user||activeChat?.id!==chatId)return;
  const {data,error}=await db.from("messages")
    .select("id,chat_id,sender_id,body,created_at,attachment_path,attachment_type,attachment_name,profiles(username)")
    .eq("chat_id",chatId).order("created_at",{ascending:false}).limit(100);
  if(error)return; // Realtime remains active; retry on the next poll.
  if(activeChat?.id!==chatId)return;
  (data||[]).reverse().forEach(m=>{
    const exists=$("messages").querySelector(`[data-message-id="${CSS.escape(m.id)}"]`);
    if(!exists)showMessageNotification(m);
    renderMessage(m);
  });
  scrollMessagesToBottom();
}
async function loadMessages(){
  const area=$("messages");area.replaceChildren();
  const {data,error}=await db.from("messages").select("id,chat_id,sender_id,body,created_at,attachment_path,attachment_type,attachment_name,profiles(username)").eq("chat_id",activeChat.id).order("created_at",{ascending:true}).limit(500);
  if(error){toast("Couldn't load messages.");return;}
  (data||[]).forEach(renderMessage);scrollMessagesToBottom();
}
async function renderMessage(m){
  if(!activeChat||m.chat_id!==activeChat.id)return;
  if($("messages").querySelector(`[data-message-id="${CSS.escape(m.id)}"]`))return;
  const date=new Date(m.created_at),dayKey=date.toLocaleDateString();
  if(dayKey!==lastRenderedDay){const label=document.createElement("div");label.className="day-label";label.textContent=date.toLocaleDateString([], {weekday:"long",month:"long",day:"numeric",year:"numeric"});$("messages").append(label);lastRenderedDay=dayKey;}
  const mine=m.sender_id===user.id,wrap=document.createElement("article");wrap.className="message"+(mine?" mine":"");wrap.dataset.messageId=m.id;
  const meta=document.createElement("div");meta.className="message-meta";const who=document.createElement("span");who.textContent=mine?"You":(m.profiles?.username||"Friend");const time=document.createElement("span");time.textContent=niceTime(m.created_at);time.title=date.toLocaleString();meta.append(who,time);
  const bubble=document.createElement("div");bubble.className="bubble";wrap.append(meta,bubble);$("messages").append(wrap);
  if(m.attachment_path){
    const cached=await localMediaGet(m.id).catch(()=>null);
    let mediaUrl=cached?URL.createObjectURL(cached.blob):null;
    if(!mediaUrl){const {data:media,error}=await db.storage.from("chat-media").createSignedUrl(m.attachment_path,3600);if(!error&&media?.signedUrl){mediaUrl=media.signedUrl;cacheMedia(m,mediaUrl);} }
    if(mediaUrl){
      if(m.attachment_type==="image"){const img=document.createElement("img");img.src=mediaUrl;img.alt=m.attachment_name||"Photo sent in chat";img.className="chat-media-image";img.loading="lazy";img.addEventListener("click",()=>{const v=window.open("","_blank","noopener");if(v){const image=v.document.createElement("img");image.src=img.src;image.style="max-width:100%;height:auto";v.document.body.append(image);}});bubble.append(img);}
      else if(m.attachment_type==="video"){const video=document.createElement("video");video.src=mediaUrl;video.controls=true;video.preload="metadata";video.className="chat-media-video";bubble.append(video);}
      else if(m.attachment_type==="audio"){const audio=document.createElement("audio");audio.src=mediaUrl;audio.controls=true;audio.preload="metadata";audio.className="chat-media-audio";audio.setAttribute("aria-label","Voice memo");bubble.append(audio);}
      else if(m.attachment_type==="file"){const a=document.createElement("a");a.href=mediaUrl;a.target="_blank";a.rel="noopener";a.download=m.attachment_name||"download";a.className="chat-file-link";a.textContent="📎 "+(m.attachment_name||"Download file");bubble.append(a);}
    }else{const unavailable=document.createElement("span");unavailable.textContent="Media unavailable";bubble.append(unavailable);}
  }
  if(m.body&&!((m.attachment_type==="image"&&m.body==="📷 Photo")||(m.attachment_type==="video"&&m.body==="🎬 Video")||(m.attachment_type==="audio"&&m.body==="🎙 Voice memo"))){const caption=document.createElement("div");linkifyText(m.body,caption);bubble.append(caption);}
  scrollMessagesToBottom();
}
$("message-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!activeChat)return;const input=$("message-input"),body=input.value.trim();if(!body)return;
  input.disabled=true;
  const {error}=await db.from("messages").insert({chat_id:activeChat.id,sender_id:user.id,body});
  input.disabled=false;if(error){toast("Message didn't send. Check your connection.");return;}input.value="";input.style.height="auto";input.focus();
});
$("message-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("message-form").requestSubmit();}});
$("message-input").addEventListener("input",e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,140)+"px";});
async function sendMedia(file){ return sendAttachment(file, null); }
async function sendAttachment(file, forcedType=null){
  if(!activeChat||!file)return;
  const type=forcedType || (file.type.startsWith("image/")?"image":file.type.startsWith("video/")?"video":file.type.startsWith("audio/")?"audio":"file");
  const actualType=type;
  if(file.size>50*1024*1024){toast("That file is too big. The limit is 50 MB.");$("media-input").value="";return;}
  let ext=(file.name?.split(".").pop()||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8);
  if(!ext) ext=type==="audio"?(file.type.includes("mp4")?"m4a":file.type.includes("ogg")?"ogg":"webm"):type==="video"?"mp4":type==="image"?"jpg":"bin";
  const chatId=activeChat.id;
  const path=`${chatId}/${user.id}/${crypto.randomUUID()}.${ext}`;
  toast(actualType==="audio"?"Sending voice memo…":"Uploading file…");
  const {error:uploadError}=await db.storage.from("chat-media").upload(path,file,{contentType:(file.type|| (type==="audio"?"audio/webm":"application/octet-stream")).split(";")[0],upsert:false});
  if(uploadError){toast("Upload failed. Check your connection and media storage setup.");$("media-input").value="";return;}
  const body=actualType==="image"?"📷 Photo":actualType==="video"?"🎬 Video":actualType==="audio"?"🎙 Voice memo":"📎 File: "+file.name.slice(0,180);
  const {error}=await db.from("messages").insert({chat_id:chatId,sender_id:user.id,body,attachment_path:path,attachment_type:actualType,attachment_name:file.name.slice(0,255)});
  if(error){await db.storage.from("chat-media").remove([path]);toast("Uploaded, but the message failed to save. Please try again.");}
  else toast(actualType==="audio"?"Voice memo sent!":actualType==="image"?"Photo sent!":actualType==="video"?"Video sent!":"File sent!");
  $("media-input").value="";
}
$("media-input").addEventListener("change",e=>{const file=e.target.files?.[0];if(file)sendMedia(file);});

async function toggleVoiceRecording(){
  const btn=$("voice-memo-btn");
  if(mediaRecorder && mediaRecorder.state==="recording"){
    btn.disabled=true;btn.textContent="…";mediaRecorder.stop();return;
  }
  if(!activeChat){toast("Open a chat first.");return;}
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){toast("Voice recording needs a modern browser and microphone permission.");return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const mimeCandidates=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus"];
    const mimeType=mimeCandidates.find(t=>MediaRecorder.isTypeSupported(t));
    mediaRecorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
    recordingChunks=[];recordingChatId=activeChat.id;
    mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size)recordingChunks.push(e.data);};
    mediaRecorder.onerror=()=>{stream.getTracks().forEach(t=>t.stop());mediaRecorder=null;btn.disabled=false;btn.textContent="🎙";btn.classList.remove("recording");toast("Recording failed. Please try again.");};
    mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const type=mediaRecorder?.mimeType||recordingChunks[0]?.type||"audio/webm";
      const blob=new Blob(recordingChunks,{type});
      const chat=chats.find(c=>c.id===recordingChatId);
      mediaRecorder=null;recordingChunks=[];btn.disabled=false;btn.textContent="🎙";btn.classList.remove("recording");
      if(blob.size===0){toast("No audio was recorded. Try again.");return;}
      const previousChat=activeChat;
      if(chat && previousChat?.id!==recordingChatId){activeChat=chat;}
      const ext=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
      const audioFile=new File([blob],`voice-memo.${ext}`,{type});
      await sendAttachment(audioFile,"audio");
      if(previousChat && activeChat?.id!==previousChat.id)activeChat=previousChat;
    };
    mediaRecorder.start();btn.textContent="■";btn.classList.add("recording");toast("Recording… tap ■ to stop and send.");
  }catch(err){toast(err?.name==="NotAllowedError"?"Allow microphone access to record a voice memo.":"Couldn't start recording. Check your microphone.");}
}
$("voice-memo-btn")?.addEventListener("click",toggleVoiceRecording);

$("create-group-btn").addEventListener("click",()=>{if(!user){toast("Please sign in first.");showSetup(false);return;}openDialog("group-dialog");});
$("group-form").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!user||!db){toast("Please sign in again, then try creating the group.");return;}
  const name=cleanName($("group-name-input").value);
  if(name.length<2){toast("Group name must have at least 2 characters.");return;}
  const btn=e.submitter||$("group-form").querySelector('button[type="submit"]');
  if(btn)btn.disabled=true;
  try{
    const {data,error}=await db.rpc("create_group_chat",{group_name:name,is_public:false,group_description:""});
    if(error){toast("Could not create group: "+error.message+". If it says function not found, run the latest supabase-setup.sql in Supabase.");return;}
    closeDialog("group-dialog");$("group-name-input").value="";
    await loadChats();
    const chat=chats.find(c=>c.id===data);
    if(chat)await selectChat(chat);
    toast("Group created! Use Add people to invite friends.");
  }catch(err){toast("Could not create group: "+(err?.message||"please try again."));}
  finally{if(btn)btn.disabled=false;}
});
$("add-people-btn").addEventListener("click",async()=>{
  if(!activeChat?.isGroup)return;
  const {data,error}=await db.rpc("create_chat_invite_for",{target_chat:activeChat.id});
  if(error){toast("Couldn't make an invite for this group.");return;}
  $("invite-code").textContent=data;openDialog("invite-dialog");
});

async function createInvite(){
  const btns=[$("create-invite-btn"),$("new-chat-btn"),$("welcome-create")];btns.forEach(b=>b.disabled=true);
  const {data,error}=await db.rpc("create_chat_invite");
  btns.forEach(b=>b.disabled=false);
  if(error){toast("Couldn't create invite. Check that you ran supabase-setup.sql.");return;}
  $("invite-code").textContent=data;openDialog("invite-dialog");await loadChats();
}
$("create-invite-btn").addEventListener("click",createInvite);$("new-chat-btn").addEventListener("click",createInvite);$("welcome-create").addEventListener("click",createInvite);
$("copy-code-btn").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("invite-code").textContent);toast("Invite code copied!");}catch{toast("Select and copy the code manually.");}});
$("invite-done-btn").addEventListener("click",()=>closeDialog("invite-dialog"));
$("join-invite-btn").addEventListener("click",()=>openDialog("join-dialog"));
$("join-form").addEventListener("submit",async e=>{
  e.preventDefault();const code=$("invite-input").value.trim().toUpperCase().replace(/\s/g,"");
  const {data,error}=await db.rpc("join_chat_with_invite",{invite_code:code});
  if(error){toast("That code is invalid, expired, or already used.");return;}
  closeDialog("join-dialog");$("invite-input").value="";await loadChats();const chat=chats.find(c=>c.id===data);if(chat)selectChat(chat);toast("You joined the private chat!");
});
$("settings-btn").addEventListener("click",()=>openDialog("settings-dialog"));
$("settings-close-btn").addEventListener("click",()=>closeDialog("settings-dialog"));
 $("settings-signout-btn")?.addEventListener("click",async()=>{if(!db)return;const {error}=await db.auth.signOut();if(error){toast("Sign out failed: "+error.message);return;}user=null;activeChat=null;chats=[];if(messageChannel)db.removeChannel(messageChannel);if(listChannel)db.removeChannel(listChannel);showSetup(false);setAuthMode("signin");setUsernameAuthMode("signin");toast("Signed out.");});
 $("settings-delete-account-btn")?.addEventListener("click",()=>toast("Permanent account deletion is not configured yet. Nothing has been deleted."));

$("settings-edit-profile-btn").addEventListener("click",()=>{closeDialog("settings-dialog");$("profile-username").value=username;$("profile-bio").value=window.myProfile?.bio||"";$("avatar-input").value="";openDialog("profile-dialog");});
$("settings-gallery-btn").addEventListener("click",()=>{closeDialog("settings-dialog");showLocalGallery();});
$("settings-notifications-yes").addEventListener("click",async()=>{if(!("Notification" in window)){toast("This browser does not support notifications.");return;}try{const permission=await Notification.requestPermission();if(permission==="granted"){localStorage.setItem("quietchat-notifications-enabled","yes");updateNotificationButtons();toast("Notifications set to Yes.");}else{localStorage.setItem("quietchat-notifications-enabled","no");updateNotificationButtons();toast("Browser permission was denied, so notifications are set to No.");}}catch{toast("Could not enable notifications.");}});
$("settings-notifications-no").addEventListener("click",()=>{localStorage.setItem("quietchat-notifications-enabled","no");updateNotificationButtons();toast("Notifications set to No.");});
const CALL_LOCATION_KEY="quietchat-call-location";
function getCallLocation(){return localStorage.getItem(CALL_LOCATION_KEY)==="tab"?"tab":"inline";}
function updateCallLocationButtons(){
  const loc=getCallLocation();
  $("settings-call-inline").setAttribute("aria-pressed",String(loc==="inline"));
  $("settings-call-tab").setAttribute("aria-pressed",String(loc==="tab"));
  $("settings-call-inline").classList.toggle("selected",loc==="inline");
  $("settings-call-tab").classList.toggle("selected",loc==="tab");
  $("settings-call-location-help").textContent=loc==="inline"?"Calls open inside the QuietChat chat window.":"Calls open in a separate browser tab. Your chat stays open here.";
}
$("settings-call-inline").addEventListener("click",()=>{localStorage.setItem(CALL_LOCATION_KEY,"inline");updateCallLocationButtons();toast("Calls will open inside QuietChat.");});
$("settings-call-tab").addEventListener("click",()=>{localStorage.setItem(CALL_LOCATION_KEY,"tab");updateCallLocationButtons();toast("Calls will open in a new tab.");});
updateCallLocationButtons();
function updateNotificationButtons(){
  const yes=localStorage.getItem("quietchat-notifications-enabled")==="yes";
  $("settings-notifications-yes").setAttribute("aria-pressed",String(yes));
  $("settings-notifications-no").setAttribute("aria-pressed",String(!yes));
  $("settings-notifications-yes").classList.toggle("selected",yes);
  $("settings-notifications-no").classList.toggle("selected",!yes);
  $("notification-state-label").textContent=yes?"Notifications are enabled.":"Notifications are off.";
}
updateNotificationButtons();
$("settings-all-export-btn").addEventListener("click",()=>{closeDialog("settings-dialog");exportAllChats();});
$("settings-export-btn").addEventListener("click",()=>{if(!activeChat)return;closeDialog("settings-dialog");window.print();});
$("media-save-mode").addEventListener("change",async e=>{localStorage.setItem(MEDIA_SAVE_KEY,e.target.value);if(e.target.value==="day")await purgeExpiredLocalMedia();toast(({none:"Automatic media saving is off.",auto:"Media will save automatically and stay until browser data is cleared.",day:"Media copies will be kept for up to 24 hours."})[e.target.value]||"Media setting saved.");closeDialog("gallery-dialog");await showLocalGallery();});
$("gallery-close-btn").addEventListener("click",()=>closeDialog("gallery-dialog"));

$("warning-continue-btn").addEventListener("click",()=>{localStorage.setItem("quietchat-warning-accepted-v1","yes");closeDialog("safety-warning-dialog");});
let currentCallUrl="";
function makeCallUrl(chat){
  // VDO.Ninja supports shared room links without requiring guests to create accounts.
  // Keep the room ID URL-safe and stable for both members of this chat.
  const room="QuietChat"+String(chat.id).replace(/[^a-zA-Z0-9]/g,"");
  const url=new URL("https://vdo.ninja/");
  url.searchParams.set("room",room);
  url.searchParams.set("label","");
  return url.toString();
}
async function startCallForChat(chat,sendInvite=true){
  if(!chat)return;
  activeChat=chat;
  currentCallUrl=makeCallUrl(chat);
  const frame=$("call-frame");
  if(getCallLocation()==="tab"){
    const opened=window.open(currentCallUrl,"_blank","noopener,noreferrer");
    if(!opened)toast("Your browser blocked the call tab. Allow pop-ups for QuietChat, or choose Inside QuietChat in Settings.");
  }else{
    frame.hidden=false;
    frame.src=currentCallUrl;
    openDialog("call-dialog");
  }
  if(sendInvite){
    const appUrl=new URL(window.location.href);
    // Prefer HTTPS on hosted sites; preserve HTTP for local development.
    if(appUrl.protocol==="http:" && !["localhost","127.0.0.1"].includes(appUrl.hostname)) appUrl.protocol="https:";
    appUrl.searchParams.set("call",chat.id);
    appUrl.hash="";
    const inviteText="📹 Join my QuietChat video call (no account needed): "+currentCallUrl+"\\nOpen QuietChat chat: "+appUrl.toString();
    const {error}=await db.from("messages").insert({chat_id:chat.id,sender_id:user.id,body:inviteText});
    toast(error?"Call opened, but the invite could not be sent to chat.":"VDO.Ninja call invite sent in chat.");
  }
}
$("call-btn").addEventListener("click",()=>{if(activeChat)startCallForChat(activeChat,true);});
$("call-new-tab-btn").addEventListener("click",()=>{if(currentCallUrl)window.open(currentCallUrl,"_blank","noopener,noreferrer");});
$("call-share-link-btn").addEventListener("click",async()=>{
  const link=window.prompt("Paste a Google Meet, Zoom, or Microsoft Teams meeting link to share:");
  if(!link||!activeChat)return;
  let parsed;try{parsed=new URL(link.trim());}catch{toast("That does not look like a valid meeting link.");return;}
  if(!["https:","http:"].includes(parsed.protocol)){toast("Please use a web meeting link.");return;}
  const {error}=await db.from("messages").insert({chat_id:activeChat.id,sender_id:user.id,body:"🎥 Join my other video meeting: "+parsed.href});
  if(error)toast("Could not share that meeting link.");else{toast("Meeting link shared in chat.");window.open(parsed.href,"_blank","noopener,noreferrer");}
});
$("end-call-btn").addEventListener("click",()=>closeDialog("call-dialog"));
$("call-dialog").addEventListener("close",()=>{$("call-frame").src="about:blank";});
// A call invite URL (?call=CHAT_ID) survives sign-in; only chats the user can access will open.
async function handleCallDeepLink(){
  const params=new URLSearchParams(window.location.search),callId=params.get("call");
  if(!callId||!user||!chats.length)return;
  const chat=chats.find(c=>c.id===callId);
  if(chat){
    params.delete("call");
    const clean=window.location.pathname+(params.toString()?"?"+params.toString():"");
    window.history.replaceState({},document.title,clean);
    await selectChat(chat);
    await startCallForChat(chat,false);
  }else{
    toast("This call link only works for an account that has joined that chat.");
  }
}

async function showAvatar(path){
  const {data,error}=await db.storage.from("profile-pics").createSignedUrl(path,3600);
  if(error||!data?.signedUrl)return;
  const av=$("my-avatar");av.textContent="";const img=document.createElement("img");img.src=data.signedUrl;img.alt="Your profile picture";img.className="profile-avatar-img";av.append(img);
}
$("profile-edit-form").addEventListener("submit",async e=>{
  e.preventDefault();const name=cleanName($("profile-username").value),bio=$("profile-bio").value.trim().slice(0,160);
  if(name.length<2){toast("Username needs at least 2 characters.");return;}
  let avatarPath=window.myProfile?.avatar_path||null;const file=$("avatar-input").files?.[0];
  if(file){if(!file.type.startsWith("image/")||file.size>5*1024*1024){toast("Choose an image smaller than 5 MB.");return;}
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8)||"jpg";
    const path=`${user.id}/${crypto.randomUUID()}.${ext}`;const up=await db.storage.from("profile-pics").upload(path,file,{contentType:file.type,upsert:false});
    if(up.error){toast("Profile picture upload failed. Run the latest SQL setup.");return;}avatarPath=path;
  }
  const {error}=await db.from("profiles").update({username:name,bio,avatar_path:avatarPath}).eq("id",user.id);
  if(error){toast("Could not save profile. Run the latest SQL setup.");return;}
  window.myProfile={username:name,bio,avatar_path:avatarPath};setProfile(name);if(avatarPath)await showAvatar(avatarPath);closeDialog("profile-dialog");await loadChats();toast("Profile saved!");
});

async function exportAllChats(){
  if(!user)return;const win=window.open("","_blank");if(!win){toast("Allow pop-ups to create your PDF export.");return;}
  win.document.write('<!doctype html><html><head><title>QuietChat export</title><style>body{font:14px Arial,sans-serif;max-width:900px;margin:30px auto;color:#111}h1,h2{page-break-after:avoid}.msg{border-bottom:1px solid #ddd;padding:8px 0;overflow-wrap:anywhere;break-inside:avoid}.meta{color:#555;font-size:12px}.attachment{display:block;margin-top:4px}a{color:#174ea6}img.export-image{display:block;max-width:420px;max-height:320px;object-fit:contain;margin-top:8px}video,audio{max-width:420px}@media print{button{display:none}}</style></head><body><h1>QuietChat — chat export</h1><p>Exported '+new Date().toLocaleString()+'</p><p>Messages and call links are included. Images are shown when they load. Other attachments use temporary private links; links may expire. Choose “Print / Save as PDF” and then “Save as PDF”.</p><div id="export-content">Preparing chats…</div><button onclick="window.print()">Print / Save as PDF</button></body></html>');win.document.close();
  const root=win.document.getElementById("export-content");root.textContent="";
  for(const chat of chats){
    const h=win.document.createElement("h2");h.textContent=chat.title;root.append(h);
    let allMessages=[],from=0,failed=false;
    while(true){
      const {data,error}=await db.from("messages").select("id,body,created_at,sender_id,attachment_path,attachment_type,attachment_name,profiles(username)").eq("chat_id",chat.id).order("created_at",{ascending:true}).range(from,from+999);
      if(error){failed=true;break;}const batch=data||[];allMessages.push(...batch);if(batch.length<1000)break;from+=1000;
    }
    if(failed){const p=win.document.createElement("p");p.textContent="Could not load this chat's messages.";root.append(p);continue;}
    for(const m of allMessages){
      const row=win.document.createElement("div");row.className="msg";const meta=win.document.createElement("div");meta.className="meta";meta.textContent=(m.sender_id===user.id?username:(m.profiles?.username||"Friend"))+" · "+new Date(m.created_at).toLocaleString();row.append(meta);
      const body=win.document.createElement("div");const textBody=m.body||"";const urls=[...textBody.matchAll(/https:\/\/[^\s]+/g)];if(urls.length){let cursor=0;for(const match of urls){body.append(win.document.createTextNode(textBody.slice(cursor,match.index)));const a=win.document.createElement("a");a.href=match[0].replace(/[),.]+$/g,"");a.textContent=a.href;a.target="_blank";a.rel="noopener";body.append(a);cursor=match.index+match[0].length;}body.append(win.document.createTextNode(textBody.slice(cursor)));}else body.textContent=textBody;row.append(body);
      if(m.attachment_path){const signed=await db.storage.from("chat-media").createSignedUrl(m.attachment_path,3600);if(!signed.error&&signed.data?.signedUrl){if(m.attachment_type==="image"){const img=win.document.createElement("img");img.className="export-image";img.src=signed.data.signedUrl;img.alt=m.attachment_name||"Chat image";row.append(img);}const a=win.document.createElement("a");a.className="attachment";a.href=signed.data.signedUrl;a.target="_blank";a.rel="noopener";a.textContent="Attachment: "+(m.attachment_name||m.attachment_type||"file")+" (open/download)";row.append(a);}}
      root.append(row);
    }
  }
  const p=win.document.createElement("p");p.textContent="All messages loaded from each chat. Image files may be printed into the PDF if loaded; video, audio and other attachments remain as links.";root.append(p);toast("Export ready. Choose Print / Save as PDF in the new tab.");
}
$("profile-export-btn")?.addEventListener("click",exportAllChats);

let gameChannel=null;
function renderRps(state){
  state=state||{round:1,moves:{},scores:{},last:null};const scores=state.scores||{};
  $("rps-score").textContent=`Round ${state.round||1} · You: ${scores[user.id]||0} · Friend(s): ${Object.entries(scores).filter(([id])=>id!==user.id).reduce((n,[,v])=>n+Number(v||0),0)}`;
  const last=state.last;if(last){const label=id=>id===user.id?"You":"Friend";const move=m=>({rock:"🪨 Rock",paper:"📄 Paper",scissors:"✂️ Scissors"}[m]||m);const winner=last.winner==="tie"?"It's a tie!":label(last.winner)+" won the round!";$("rps-last").textContent=`${label(last.p1)} chose ${move(last.m1)} · ${label(last.p2)} chose ${move(last.m2)}. ${winner}`;}else{$("rps-last").textContent=Object.keys(state.moves||{}).length?"Move received — waiting for your friend…":"Choose rock, paper, or scissors to start.";}
}
async function refreshRps(){if(!activeChat)return;const {data,error}=await db.from("chat_games").select("state").eq("chat_id",activeChat.id).eq("game_type","rps").maybeSingle();if(!error)renderRps(data?.state);}
$("game-btn").addEventListener("click",()=>{if(!activeChat)return;openDialog("game-dialog");setupGameCorner();});
document.querySelectorAll("[data-rps]").forEach(btn=>btn.addEventListener("click",async()=>{if(!activeChat)return;const {data,error}=await db.rpc("play_rps",{target_chat:activeChat.id,chosen_move:btn.dataset.rps});if(error){toast("Game failed to update. Run the latest SQL setup.");return;}renderRps(data);}));
const emojiList="😀 😃 😄 😁 😆 😅 😂 🙂 🙃 😉 😊 😍 🥰 😎 🤩 🥳 😭 😡 🤔 🙄 😴 🤯 🥺 😇 🤗 🤝 👍 👎 👏 🙌 💪 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 🔥 ✨ ⭐ 🌈 ☀️ 🌙 ⚡ 🎉 🎊 🎮 🎲 🏆 🥇 ⚽ 🏀 🚗 🐱 🐶 🐸 🦊 🐼 🐵 🍕 🍔 🍟 🍎 🍌 🍓 🍪 ☕ 🎂".split(" ");
const eg=$("emoji-grid");emojiList.forEach(emoji=>eg.append(gameButton(emoji,()=>{const input=$("message-input");input.value+=emoji;input.focus();closeDialog("emoji-dialog");}))); 
if($("emoji-btn")) $("emoji-btn").addEventListener("click",()=>openDialog("emoji-dialog"));
$("gif-search-btn").addEventListener("click",()=>{const q=$("gif-search").value.trim();if(!q){toast("Type what GIF you want to find.");return;}window.open("https://tenor.com/search/"+encodeURIComponent(q)+"-gifs","_blank","noopener,noreferrer");$("gif-results").textContent="Tenor opened in a new tab. Copy a GIF link and paste it into your QuietChat message.";});
$("gif-search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("gif-search-btn").click();}});


 // Composer plus menu: keep attachment, emoji/GIF, voice memo and dictation together.
 $("composer-plus-btn")?.addEventListener("click",()=>openDialog("composer-tools-dialog"));
 $("tool-file-btn")?.addEventListener("click",()=>{closeDialog("composer-tools-dialog");$("media-input").click();});
 $("tool-emoji-btn")?.addEventListener("click",()=>{closeDialog("composer-tools-dialog");openDialog("emoji-dialog");});
 $("tool-gif-btn")?.addEventListener("click",()=>{closeDialog("composer-tools-dialog");openDialog("emoji-dialog");$("gif-search")?.focus();});
 $("tool-voice-memo-btn")?.addEventListener("click",()=>{closeDialog("composer-tools-dialog");toggleVoiceRecording();});
 $("tool-voice-text-btn")?.addEventListener("click",()=>{closeDialog("composer-tools-dialog");startVoiceToText();});
 function startVoiceToText(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){toast("Voice-to-text is not supported in this browser. Try Chrome or Edge.");return;}
  const recognition=new SpeechRecognition();recognition.lang=navigator.language||"en-CA";recognition.interimResults=true;recognition.continuous=false;
  const input=$("message-input");const old=input.value;toast("Listening… speak your message.");
  recognition.onresult=e=>{let words="";for(let i=e.resultIndex;i<e.results.length;i++)words+=e.results[i][0].transcript;input.value=(old?old+" ":"")+words;input.focus();};
  recognition.onerror=e=>toast(e.error==="not-allowed"?"Allow microphone access for voice-to-text.":"Voice-to-text stopped. Try again.");
  recognition.onend=()=>input.focus();try{recognition.start();}catch{toast("Voice-to-text could not start. Try again.");}
 }
 $("group-settings-btn")?.addEventListener("click",()=>openDialog("group-settings-dialog"));
 $("communities-btn")?.addEventListener("click",()=>{openDialog("communities-dialog");showCommunityView("discover");loadMyCommunities();});
 $("sidebar-discover-btn")?.addEventListener("click",()=>{openDialog("communities-dialog");showCommunityView("discover");loadMyCommunities();});
 async function loadMyCommunities(){
   const list=$("community-list");if(!list)return;
   if(!user){list.innerHTML='<div class="community-empty"><strong>Sign in to view your communities</strong></div>';return;}
   await loadChats();const groups=chats.filter(c=>c.isGroup);list.replaceChildren();
   if(!groups.length){list.innerHTML='<div class="community-empty"><strong>No communities yet</strong><p class="muted">Create a private community or accept an invite from a friend.</p></div>';return;}
   groups.forEach(g=>{const card=document.createElement("article");card.className="discover-group-card";const details=document.createElement("div");details.className="discover-group-details";const title=document.createElement("strong");title.textContent=g.title;const meta=document.createElement("small");meta.textContent=(g.memberCount||1)+" members · "+(g.isPublic?"Public":"Private");details.append(title,meta);const btn=document.createElement("button");btn.className="primary discover-join";btn.type="button";btn.textContent="Open";btn.addEventListener("click",()=>{closeDialog("communities-dialog");selectChat(g);});card.append(details,btn);list.append(card);});
 }
 function showCommunityView(view){document.querySelectorAll("[data-community-view]").forEach(btn=>btn.classList.toggle("active",btn.dataset.communityView===view));["discover","public","create"].forEach(n=>$("community-"+n+"-panel")?.classList.toggle("hidden",n!==view));}
 $("refresh-communities-btn")?.addEventListener("click",loadMyCommunities);
 async function loadPublicCommunities(){
   const list=$("public-community-list");if(!list)return;list.replaceChildren();
   const {data,error}=await db.rpc("discover_public_groups");
   if(error){list.innerHTML='<div class="community-empty"><strong>Public group listing needs a database update</strong><p class="muted tiny">The secure list_public_groups database function is not available yet.</p></div>';return;}
   if(!Array.isArray(data)||!data.length){list.innerHTML='<div class="community-empty"><strong>No public communities found</strong></div>';return;}
   data.forEach(g=>{const card=document.createElement("article");card.className="discover-group-card";const details=document.createElement("div");details.className="discover-group-details";const title=document.createElement("strong");title.textContent=g.name||g.group_name||"Public community";const meta=document.createElement("small");meta.textContent=(g.description?g.description+" · ":"")+"Public · Text and GIFs only · "+g.member_count+" members";details.append(title,meta);const btn=document.createElement("button");btn.className="primary discover-join";btn.type="button";btn.textContent=g.is_member?"Open community":"Join community";btn.addEventListener("click",async()=>{if(!g.is_member){const {error:joinError}=await db.rpc("join_public_group",{target_chat:g.id||g.chat_id});if(joinError){toast("Could not join: "+joinError.message);return;}toast("You joined the community!");}await loadChats();await loadPublicCommunities();const chat=chats.find(x=>x.id===(g.id||g.chat_id));if(chat){closeDialog("communities-dialog");selectChat(chat);}});card.append(details,btn);list.append(card);});
 }
 $("refresh-public-communities-btn")?.addEventListener("click",loadPublicCommunities);
 document.querySelectorAll("[data-community-view]").forEach(btn=>btn.addEventListener("click",()=>{showCommunityView(btn.dataset.communityView);if(btn.dataset.communityView==="discover")loadMyCommunities();if(btn.dataset.communityView==="public")loadPublicCommunities();}));
 $("community-create-form")?.addEventListener("submit",async ev=>{
  ev.preventDefault();
  if(!user||!db){toast("Please sign in first, then try again.");return;}
  const name=cleanName($("community-name").value);
  if(name.length<2){toast("Group name needs at least 2 characters.");return;}
  const form= $("community-create-form"),btn=form.querySelector('button[type="submit"]');
  if(btn)btn.disabled=true;
  try{
    const isPublic=$("community-is-public")?.checked||false;
    const description=$("community-description")?.value||"";
    const {data,error}=await db.rpc("create_group_chat",{group_name:name,is_public:isPublic,group_description:description});
    if(error){toast("Could not create community: "+error.message+". If the function is missing, run the latest supabase-setup.sql in Supabase.");return;}
    toast(isPublic?"Public community created!":"Private community created! Use Add people to invite friends.");
    form.reset();closeDialog("communities-dialog");await loadChats();
    const chat=chats.find(c=>c.id===data);if(chat)await selectChat(chat);
  }catch(err){toast("Could not create community: "+(err?.message||"please try again."));}
  finally{if(btn)btn.disabled=false;}
});
 $("save-group-settings")?.addEventListener("click",async()=>{if(!activeChat?.isGroup){toast("Open a community first.");return;}const isPublic=document.querySelector('input[name="existing-group-visibility"]:checked')?.value==="public";const allowGifs=$("group-allow-gifs").checked;const removeInactive=$("group-inactivity-rule").checked;const {error}=await db.rpc("update_group_settings",{target_chat:activeChat.id,make_public:isPublic,allow_gifs:allowGifs,remove_inactive:removeInactive});if(error){toast("Could not save changes: "+error.message);return;}toast("Community settings saved.");await loadChats();const fresh=chats.find(x=>x.id===activeChat.id);if(fresh)selectChat(fresh);closeDialog("group-settings-dialog");});
 
 $("group-settings-btn")?.addEventListener("click",()=>{if(!activeChat?.isGroup)return;document.querySelectorAll('input[name="existing-group-visibility"]').forEach(x=>x.checked=(x.value==="public"&&activeChat.isPublic)||(x.value==="private"&&!activeChat.isPublic));$("group-allow-gifs").checked=!!activeChat.allowGifs;$("group-inactivity-rule").checked=activeChat.removeInactive!==false;openDialog("group-settings-dialog");});
 $("delete-group-btn")?.addEventListener("click",async()=>{if(!activeChat?.isGroup){toast("Open a group first.");return;}if(!confirm('Delete "'+activeChat.title+'" and its group chat? This cannot be undone.'))return;const id=activeChat.id;const {error}=await db.rpc("delete_group_chat",{target_chat:id});if(error){toast("Could not delete group: "+error.message+" (secure delete function may need installing)");return;}if(messageChannel){db.removeChannel(messageChannel);messageChannel=null;}activeChat=null;$("app-screen").classList.remove("chat-open");$("welcome-panel").classList.remove("hidden");$("messages").classList.add("hidden");$("composer-wrap").classList.add("hidden");await loadChats();await loadMyCommunities();toast("Group deleted.");});
 $("mobile-back").addEventListener("click",()=>{$("app-screen").classList.remove("chat-open");});
function subscribeChatList(){
  if(listChannel)db.removeChannel(listChannel);
  listChannel=db.channel("my-chat-members-"+user.id).on("postgres_changes",{event:"*",schema:"public",table:"chat_members",filter:"user_id=eq."+user.id},async()=>{await loadChats();if(activeChat){const fresh=chats.find(c=>c.id===activeChat.id);if(fresh){activeChat=fresh;$("chat-title").textContent=fresh.title;}}}).subscribe();
}
start();


// Intentionally plain JavaScript: eight local pass-and-play games plus synced RPS.
const gameCatalog=[['uno','🟥 UNO'],['ttt','❎ Tic-tac-toe'],['connect','🔴 Connect 4'],['checkers','🔴 Checkers'],['chess','♟ Chess'],['battle','🚢 Battleship'],['memory','🧠 Memory'],['hangman','🔤 Hangman'],['rps','✂️ Rock Paper Scissors']];
let chosenGame='',gameState={};
function gameButton(label,fn,cls='secondary'){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.addEventListener('click',fn);return b;}
function gameText(text,cls='game-status'){const p=document.createElement('p');p.className=cls;p.textContent=text;return p;}
function gameReset(){gameState={};renderLocalGame();}
function buildGamePicker(){const root=document.getElementById('game-picker');root.replaceChildren();for(const [id,label] of gameCatalog){const b=gameButton(label,()=>{chosenGame=id;document.querySelectorAll('#game-picker button').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(id==='rps'){document.getElementById('game-board').classList.add('hidden');document.getElementById('online-rps').classList.remove('hidden');refreshRps();if(gameChannel)db.removeChannel(gameChannel);gameChannel=db.channel('rps-'+activeChat.id).on('postgres_changes',{event:'*',schema:'public',table:'chat_games',filter:'chat_id=eq.'+activeChat.id},payload=>renderRps(payload.new?.state)).subscribe();}else{if(gameChannel){db.removeChannel(gameChannel);gameChannel=null;}document.getElementById('online-rps').classList.add('hidden');document.getElementById('game-board').classList.remove('hidden');gameReset();}},'');root.append(b);}}
function renderLocalGame(){const root=document.getElementById('game-board');root.replaceChildren();if(!chosenGame||chosenGame==='rps')return;root.append(gameText('Pass-and-play: take turns on this device.'));const s=gameState;
 if(chosenGame==='ttt'){if(!s.board)s.board=Array(9).fill('');if(!s.turn)s.turn='X';if(s.done===undefined)s.done=false;const win=[[0,1,2],[3,4,5],[6,7,8]].concat([[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]).find(a=>s.board[a[0]]&&s.board[a[0]]===s.board[a[1]]&&s.board[a[1]]===s.board[a[2]]);if(win)s.done=true;root.append(gameText(win?'Player '+s.board[win[0]]+' wins!':s.board.every(Boolean)?'It is a draw!':'Player '+s.turn+' turn'));const grid=document.createElement('div');grid.className='board-grid tic';s.board.forEach((v,i)=>grid.append(gameButton(v||'·',()=>{if(s.done||s.board[i])return;s.board[i]=s.turn;s.turn=s.turn==='X'?'O':'X';const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];if(wins.some(a=>s.board[a[0]]&&s.board[a[0]]===s.board[a[1]]&&s.board[a[1]]===s.board[a[2]])||s.board.every(Boolean))s.done=true;renderLocalGame();})));root.append(grid);
 }else if(chosenGame==='connect'){if(!s.board)s.board=Array.from({length:6},()=>Array(7).fill(''));if(!s.turn)s.turn='🔴';if(s.done===undefined)s.done=false;root.append(gameText(s.done?'Game over — reset to play again.':s.turn+' turn'));const grid=document.createElement('div');grid.className='board-grid connect';for(let c=0;c<7;c++)grid.append(gameButton('↓',()=>{if(s.done)return;for(let r=5;r>=0;r--)if(!s.board[r][c]){s.board[r][c]=s.turn;let win=false;for(let rr=0;rr<6;rr++)for(let cc=0;cc<7;cc++){const val=s.board[rr][cc];if(val&&[[0,1],[1,0],[1,1],[1,-1]].some(([dr,dc])=>Array.from({length:4},(_,k)=>[rr+dr*k,cc+dc*k]).every(([y,x])=>y>=0&&y<6&&x>=0&&x<7&&s.board[y][x]===val)))win=true;}if(win)s.done=true;else s.turn=s.turn==='🔴'?'🟡':'🔴';break;}renderLocalGame();}));root.append(grid);const board=document.createElement('div');board.className='board-grid connect';s.board.flat().forEach(v=>{const b=document.createElement('span');b.textContent=v||'⚪';b.style.textAlign='center';b.style.fontSize='20px';board.append(b)});root.append(board);
 }else if(chosenGame==='uno'){if(!s.started){s.started=true;s.hands=[[],[]];const colors=['red','blue','green','yellow'];s.deck=[];for(let c of colors)for(let n=0;n<=9;n++)s.deck.push({c,n:String(n)});s.deck.sort(()=>Math.random()-.5);for(let i=0;i<7;i++)for(let p=0;p<2;p++)s.hands[p].push(s.deck.pop());s.top=s.deck.pop();s.turn=0;}const colors=['red','blue','green','yellow'];root.append(gameText('Player '+(s.turn+1)+' turn · Top card: '+s.top.c.toUpperCase()+' '+s.top.n));const pile=gameButton('Draw card',()=>{if(s.deck.length)s.hands[s.turn].push(s.deck.pop());s.turn=1-s.turn;renderLocalGame();});root.append(pile);const hand=document.createElement('div');hand.className='uno-hand';s.hands[s.turn].forEach((card,i)=>{const b=gameButton(card.n,()=>{if(card.c===s.top.c||card.n===s.top.n){s.top=card;s.hands[s.turn].splice(i,1);if(!s.hands[s.turn].length){s.winner=s.turn+1;}else s.turn=1-s.turn;renderLocalGame();}else toast('Play a matching colour or number.');},'uno-card '+card.c);hand.append(b)});root.append(hand);if(s.winner)root.append(gameText('Player '+s.winner+' wins UNO!'));root.append(gameText('Simplified UNO: match colour or number; draw one if you cannot play.','game-small'));
 }else if(chosenGame==='memory'){if(!s.cards){s.cards=['🐱','🐶','🐸','🦊','🐼','🐵','🦄','🐙', '🐱','🐶','🐸','🦊','🐼','🐵','🦄','🐙'].sort(()=>Math.random()-.5);s.open=[];s.found=[];s.turn=1;s.lock=false;}root.append(gameText('Player '+s.turn+' turn · pairs found: '+s.found.length/2));const grid=document.createElement('div');grid.className='memory-grid';s.cards.forEach((v,i)=>grid.append(gameButton(s.found.includes(i)||s.open.includes(i)?v:'❔',()=>{if(s.lock||s.found.includes(i)||s.open.includes(i))return;s.open.push(i);if(s.open.length===2){s.lock=true;setTimeout(()=>{if(s.cards[s.open[0]]===s.cards[s.open[1]])s.found.push(...s.open);else s.turn=3-s.turn;s.open=[];s.lock=false;renderLocalGame();},650);}renderLocalGame();})));root.append(grid);if(s.found.length===16)root.append(gameText('All pairs found!'));
 }else if(chosenGame==='hangman'){const words=['PLANET','ROCKET','GARDEN','PUZZLE','BANANA','DRAGON'];if(!s.word){s.word=words[Math.floor(Math.random()*words.length)];s.guessed=[];s.bad=0;}root.append(gameText('Player 1 picks a word in their head; pass the screen to Player 2 to guess.'));root.append(gameText(s.word.split('').map(c=>s.guessed.includes(c)?c:'_').join(' ')));root.append(gameText('Wrong guesses: '+s.bad+'/6'));const keys=document.createElement('div');keys.className='game-actions';'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(c=>keys.append(gameButton(c,()=>{if(s.guessed.includes(c)||s.bad>=6)return;s.guessed.push(c);if(!s.word.includes(c))s.bad++;renderLocalGame();})));root.append(keys);if(s.bad>=6||s.word.split('').every(c=>s.guessed.includes(c)))root.append(gameText(s.bad>=6?'Game over. Word: '+s.word:'You guessed it!'));
 }else if(chosenGame==='battle'){if(!s.started){s.started=true;s.ships=[Math.floor(Math.random()*25),Math.floor(Math.random()*25)];while(s.ships[1]===s.ships[0])s.ships[1]=Math.floor(Math.random()*25);s.shots=[];}root.append(gameText('Find the two hidden ships on the 5×5 grid. Take turns; ships are hidden randomly.'));const grid=document.createElement('div');grid.className='board-grid battle';for(let i=0;i<25;i++)grid.append(gameButton(s.shots.includes(i)?(s.ships.includes(i)?'💥':'·'):'🌊',()=>{if(s.shots.includes(i))return;s.shots.push(i);if(s.ships.includes(i))s.hit=(s.hit||0)+1;renderLocalGame();}));root.append(grid);root.append(gameText('Ships hit: '+(s.hit||0)+'/2'));
 }else if(chosenGame==='checkers'){if(!s.board){s.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>((r+c)%2===1&&r<3)?'●':((r+c)%2===1&&r>4)?'○':''));s.turn='○';s.selected=null;}root.append(gameText('Player '+(s.turn==='○'?'1 (light)':'2 (dark)')+' turn. Tap a piece then a dark square. Basic moves only.'));const grid=document.createElement('div');grid.className='board-grid checkers';s.board.forEach((row,r)=>row.forEach((v,c)=>{const b=gameButton(v||'',()=>{if(s.selected){const [sr,sc]=s.selected;if(!s.board[r][c]&&((Math.abs(r-sr)===1&&Math.abs(c-sc)===1)||(Math.abs(r-sr)===2&&Math.abs(c-sc)===2))){s.board[r][c]=s.board[sr][sc];s.board[sr][sc]='';if(Math.abs(r-sr)===2)s.board[(r+sr)/2][(c+sc)/2]='';s.turn=s.turn==='○'?'●':'○';}s.selected=null;}else if(v===s.turn)s.selected=[r,c];renderLocalGame();});b.className+=' '+((r+c)%2?'dark':'light')+(v==='●'?' blackpiece':v==='○'?' redpiece':'');grid.append(b)}));root.append(grid);
 }else if(chosenGame==='chess'){if(!s.board){s.board=['♜','♞','♝','♛','♚','♝','♞','♜','♟','♟','♟','♟','♟','♟','♟','♟',...Array(32).fill(''), '♙','♙','♙','♙','♙','♙','♙','♙','♖','♘','♗','♕','♔','♗','♘','♖'];s.turn='white';s.selected=null;}root.append(gameText('Player '+(s.turn==='white'?'White':'Black')+' turn. Select a piece and a square to move. Simplified board: movement rules are not enforced.'));const grid=document.createElement('div');grid.className='board-grid chess';s.board.forEach((v,i)=>{const r=Math.floor(i/8),c=i%8;const b=gameButton(v||' ',()=>{if(s.selected!==null){s.board[i]=s.board[s.selected];s.board[s.selected]='';s.selected=null;s.turn=s.turn==='white'?'black':'white';}else if(v)s.selected=i;renderLocalGame();});b.className+=' '+((r+c)%2?'dark':'light');grid.append(b)});root.append(grid);
 }
 root.append(gameButton('↻ Restart game',gameReset,'secondary'));
}
function setupGameCorner(){buildGamePicker();}

