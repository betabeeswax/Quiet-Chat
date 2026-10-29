/* QuietChat — plain JavaScript + Supabase.
   Put your Supabase Project URL and publishable (or legacy anon) key below.
   Never put a service_role key in browser code. */
const SUPABASE_URL = "https://zdmkuookuljcintzgzrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eIjdkSKcO53agFW0J26A5Q_ENp_-m32";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const $ = (id) => document.getElementById(id);
let db, user, username = "", activeChat = null, chats = [], messageChannel = null, listChannel = null, messageRefreshTimer = null, toastTimer, authMode = "signin", usernameAuthMode = "signin", mediaRecorder = null, recordingChunks = [], recordingChatId = null, lastRenderedDay = "";

const setup = $("setup-screen"), app = $("app-screen");
const QUIETCHAT_ADMIN_IDS = ["6690d263-46ff-4cb3-a257-c4235fcb9ae1","33101fc2-e3f1-4b32-adb6-85c17a099aac"];
function isQuietChatAdmin(){return !!user?.id && QUIETCHAT_ADMIN_IDS.includes(user.id);}
function canManageCommunity(chat=activeChat){return !!chat?.isGroup && (isQuietChatAdmin() || chat.createdBy===user?.id);}
function isGifFile(file){return /\.gif$/i.test(file?.name||"") && (!file.type || file.type.toLowerCase()==="image/gif");}
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2800); }
function showSetup(needsProfile=false){setup.classList.remove("hidden");app.classList.add("hidden");$("auth-options").classList.toggle("hidden",needsProfile);$("profile-setup").classList.toggle("hidden",!needsProfile);}
function showApp(){setup.classList.add("hidden");app.classList.remove("hidden");const guest=!!user?.is_anonymous;$("account-label").textContent=guest?"Guest · expires after 47 inactive days":(user?.email||"Signed-in account");$("create-group-btn").disabled=false;$("create-group-btn").title="";$("create-group-btn").textContent="＋ Create group chat";$("chat-remove-btn").disabled=guest;}
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
function showMessageNotification(m){if(!m||m.sender_id===user?.id||!document.hidden)return;if(localStorage.getItem("quietchat-notifications-enabled")!=="yes")return;
  try{const muted=JSON.parse(localStorage.getItem("quietchat-muted-chats-"+user.id)||"[]");if(muted.includes(m.chat_id))return;}catch{}const body=m.attachment_type?`Sent a ${m.attachment_type}.`:String(m.body||"New message").slice(0,120);if("Notification" in window&&Notification.permission==="granted"){try{new Notification(activeChat?.title||"New QuietChat message",{body,tag:"quietchat-"+m.id});}catch{}}}
const cussingToggle=$("settings-cussing-filter");
if(cussingToggle){cussingToggle.checked=cussingFilterEnabled();cussingToggle.addEventListener("change",()=>{try{localStorage.setItem("quietchat-cussing-filter",String(cussingToggle.checked));}catch{};if(activeChat)selectChat(activeChat);toast(cussingToggle.checked?"Cussing filter enabled on this device.":"Cussing filter turned off.");});}
function checkFirstWarning(){if(!localStorage.getItem("quietchat-warning-accepted-v1"))openDialog("safety-warning-dialog");}

// Best-effort profanity filter: catches common spelling, leetspeak, repeated-letter,
// and punctuation/space-separated variants. No text filter can catch every evasion.
const SWEAR_PATTERNS=[
  /\bf[\W_]*[uüv\*4@]+[\W_]*c[\W_]*k(?:[\W_]*(?:i|1|!)[\W_]*n[\W_]*g|[\W_]*e[\W_]*d|[\W_]*e[\W_]*r|[\W_]*e[\W_]*r[\W_]*s)?\b/gi,
  /\bs[\W_]*h[\W_]*[i1!|]+[\W_]*t(?:[\W_]*t[\W_]*y|[\W_]*t[\W_]*i[\W_]*n[\W_]*g|[\W_]*s)?\b/gi,
  /\bb[\W_]*[i1!|]+[\W_]*t[\W_]*c[\W_]*h(?:[\W_]*e[\W_]*s)?\b/gi,
  /\ba[\W_]*s[\W_]*s[\W_]*h[\W_]*[o0]+[\W_]*l[\W_]*e\b/gi,
  /\bb[\W_]*[a@4]+[\W_]*s[\W_]*t[\W_]*[a@4]+[\W_]*r[\W_]*d\b/gi,
  /\bd[\W_]*[a@4]+[\W_]*m[\W_]*n\b/gi,
  /\bc[\W_]*[uüv\*]+[\W_]*n[\W_]*t\b/gi,
  /\bd[\W_]*[i1!|]+[\W_]*c[\W_]*k(?:[\W_]*h[\W_]*e[\W_]*a[\W_]*d)?\b/gi,
  /\bm[\W_]*[o0]+[\W_]*t[\W_]*h[\W_]*e[\W_]*r[\W_]*f[\W_]*[uüv]+[\W_]*c[\W_]*k[\W_]*e[\W_]*r\b/gi,
  /\bb[\W_]*[uüv]+[\W_]*l[\W_]*l[\W_]*s[\W_]*h[\W_]*[i1!|]+[\W_]*t\b/gi,
  /\b(?:w[\W_]*h[\W_]*o[\W_]*r[\W_]*e|s[\W_]*l[\W_]*u[\W_]*t|p[\W_]*i[\W_]*s[\W_]*s|d[\W_]*[i1!|]+[\W_]*l[\W_]*d[\W_]*o|c[\W_]*o[\W_]*c[\W_]*k|t[\W_]*w[\W_]*a[\W_]*t)\b/gi
];
function cussingFilterEnabled(){try{return localStorage.getItem("quietchat-cussing-filter")==="true";}catch{return false;}}
function filterCussing(text){if(!cussingFilterEnabled())return String(text);return SWEAR_PATTERNS.reduce((value,pattern)=>value.replace(pattern,"••••"),String(text));}
function setProfile(name){username=name;$("my-name").textContent=name;$("my-avatar").textContent=initials(name);}
function openDialog(id){$(id).showModal();}
const AUTO_SCROLL_KEY="quietchat-auto-scroll-v1";
function getAutoScroll(){try{return localStorage.getItem(AUTO_SCROLL_KEY)==="on";}catch{return false;}}
function isNearMessageBottom(area){return area.scrollHeight-area.scrollTop-area.clientHeight<80;}
function updateGoBottomButton(){const area=$("messages"),btn=$("go-to-bottom-btn");if(!area||!btn)return;const away=area.scrollHeight-area.scrollTop-area.clientHeight>=80;btn.classList.toggle("hidden",area.classList.contains("hidden")||!away);}
function scrollMessagesToBottom(force=false){const area=$("messages");if(!area)return;if(!force&&!getAutoScroll()){updateGoBottomButton();return;}requestAnimationFrame(()=>{area.scrollTo({top:area.scrollHeight,behavior:"smooth"});requestAnimationFrame(()=>{if(force||getAutoScroll())area.scrollTop=area.scrollHeight;updateGoBottomButton();});});}
function closeDialog(id){$(id).close();}

async function start(){
  try{
    if(!configured){$("config-warning").classList.remove("hidden");showSetup(false);return;}
    if(!window.supabase||typeof window.supabase.createClient!=="function"){
      showSetup(false);toast("QuietChat could not start: Supabase library did not load. Refresh the page or check your connection.");return;
    }
    db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    setAuthMode("signin");setUsernameAuthMode("signin");checkFirstWarning();
    const {data,error}=await db.auth.getSession();
    if(error)throw error;
    if(data?.session){user=data.session.user;await loadProfile();}
    else showSetup(false);
  }catch(error){
    console.error("QuietChat startup failed:",error);
    showSetup(false);
    toast("QuietChat startup error: "+(error?.message||"Unknown error"));
  }
}
async function touchActivity(){if(!user?.id||!db)return;try{await db.rpc("quietchat_touch_activity");}catch(e){console.warn("Activity timestamp not updated",e);}}
let lastActivityTouch=0;
function scheduleActivityTouch(){const now=Date.now();if(now-lastActivityTouch<60000)return;lastActivityTouch=now;touchActivity();}
document.addEventListener("pointerdown",scheduleActivityTouch,{passive:true});
document.addEventListener("keydown",scheduleActivityTouch);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)scheduleActivityTouch();});
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("username,bio,avatar_path").eq("id",user.id).maybeSingle();
  if(error){toast("Could not load your profile: "+error.message);user=null;showSetup(false);return;}
  if(data?.username){setProfile(data.username);window.myProfile=data;$("profile-bio").value=data.bio||"";if(data.avatar_path)await showAvatar(data.avatar_path);await touchActivity();showApp();await loadChats();subscribeChatList();subscribeOnlineUsers();handleInviteLink();}
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
  try{
    // Avoid PostgREST relationship joins entirely: some projects don't have
    // the chat_members -> chats relationship available in the schema cache.
    const {data:myMemberships,error:myMembershipsError}=await db
      .from("chat_members").select("chat_id").eq("user_id",user.id);
    if(myMembershipsError) throw new Error("Couldn't find your chat memberships: "+myMembershipsError.message);
    const ids=[...new Set((myMemberships||[]).map(m=>m.chat_id).filter(Boolean))];
    if(!ids.length){
      chats=[];
      window.chatProfileLookup={};
      renderChats();
      await handleCallDeepLink();
      return;
    }
    const {data:chatRows,error:chatError}=await db.from("chats")
      .select("id,name,created_at,is_public,description,allow_gifs,remove_inactive,created_by,logo_path,notifications_enabled,is_adult")
      .in("id",ids);
    if(chatError) throw new Error("Memberships loaded, but chat details couldn't load: "+chatError.message);
    const validChats=chatRows||[];
    const validIds=validChats.map(c=>c.id);
    if(!validIds.length){
      chats=[];window.chatProfileLookup={};renderChats();await handleCallDeepLink();return;
    }
    const {data:memberships,error:membersError}=await db.from("chat_members")
      .select("chat_id,user_id").in("chat_id",validIds);
    if(membersError) throw new Error("Chats loaded, but member lists couldn't load: "+membersError.message);
    const userIds=[...new Set((memberships||[]).map(m=>m.user_id).filter(Boolean))];
    let profiles=[];
    if(userIds.length){
      const {data,error}=await db.from("profiles").select("id,username,avatar_path,bio").in("id",userIds);
      if(error) throw new Error("Chats loaded, but usernames couldn't load: "+error.message);
      profiles=data||[];
    }
    const profileById=Object.fromEntries(profiles.map(p=>[p.id,p]));
    const membersByChat={};
    (memberships||[]).forEach(m=>{(membersByChat[m.chat_id] ||= []).push({...m,profiles:profileById[m.user_id]||null});});
    const chatById=Object.fromEntries(validChats.map(c=>[c.id,c]));
    window.chatProfileLookup={};
    chats=validIds.map(chatId=>{
      const chat=chatById[chatId]||{};
      const allMembers=membersByChat[chatId]||[];
      const members=allMembers.filter(m=>m.user_id!==user.id);
      const memberCount=allMembers.length||1;
      const other=members[0]?.profiles?.username||"Waiting for friend";
      if(members[0]?.profiles)window.chatProfileLookup[chatId]=members[0].profiles;
      return {id:chatId,created_at:chat.created_at,title:chat.name||other,memberCount,isGroup:Boolean(chat.name),isAdult:!!chat.is_adult,bio:members[0]?.profiles?.bio||"",isPublic:!!chat.is_public,description:chat.description||"",allowGifs:chat.allow_gifs!==false,removeInactive:chat.remove_inactive!==false,createdBy:chat.created_by,logoPath:chat.logo_path||null,notificationsEnabled:chat.notifications_enabled!==false,memberIds:allMembers.map(m=>({id:m.user_id,name:m.profiles?.username||"Member"})),memberNames:allMembers.map(m=>m.profiles?.username).filter(Boolean)};
    });
    renderChats();
    if(!activeChat&&chats.length){
      let remembered="";
      try{remembered=localStorage.getItem("quietchat-last-chat-"+user.id)||"";}catch{}
      const last=chats.find(c=>c.id===remembered);
      await selectChat(last||chats[0]);
    }
    await handleCallDeepLink();
  }catch(error){
    console.error("QuietChat loadChats failed:",error);
    toast(error?.message||"Couldn't load chats. Please try again.");
  }
}
function rowProfileForChat(chatId){return window.chatProfileLookup?.[chatId]||null;}
function setChatListView(view){const servers=view==="servers";$("server-list-panel")?.classList.toggle("hidden",!servers);$("direct-list-panel")?.classList.toggle("hidden",servers);$("show-servers-btn")?.classList.toggle("active",servers);$("show-dms-btn")?.classList.toggle("active",!servers);$("show-servers-btn")?.setAttribute("aria-pressed",String(servers));$("show-dms-btn")?.setAttribute("aria-pressed",String(!servers));try{localStorage.setItem("quietchat-list-view",view);}catch{}}
$("show-servers-btn")?.addEventListener("click",()=>setChatListView("servers"));
$("show-dms-btn")?.addEventListener("click",()=>setChatListView("dms"));
setChatListView(localStorage.getItem("quietchat-list-view")==="dms"?"dms":"servers");

const CHAT_PIN_KEY="quietchat-pinned-chats-v1";
function getPinnedChats(){try{return JSON.parse(localStorage.getItem(CHAT_PIN_KEY)||"[]");}catch{return [];}}
function isChatMuted(chatId){try{return JSON.parse(localStorage.getItem("quietchat-muted-chats-"+user.id)||"[]").includes(chatId);}catch{return false;}}
function showChatContextMenu(event,chat){
  const menu=$("chat-context-menu");if(!menu)return;
  menu.dataset.chatId=chat.id;menu.dataset.isGroup=String(!!chat.isGroup);
  $("context-menu-title").textContent=chat.title;
  $("context-open-chat").textContent="Open chat";
  $("context-pin-chat").textContent=getPinnedChats().includes(chat.id)?"Unpin chat":"Pin chat";
  $("context-mute-chat").textContent=isChatMuted(chat.id)?"Unmute notifications":"Mute notifications";
  $("context-remove-chat").textContent=chat.isGroup?"Leave community":"Remove chat";
  menu.classList.remove("hidden");menu.style.left="0px";menu.style.top="0px";
  const rect=menu.getBoundingClientRect(),x=Math.min(event.clientX,window.innerWidth-rect.width-10),y=Math.min(event.clientY,window.innerHeight-rect.height-10);
  menu.style.left=Math.max(10,x)+"px";menu.style.top=Math.max(10,y)+"px";
}
function closeChatContextMenu(){ $("chat-context-menu")?.classList.add("hidden"); }
document.addEventListener("click",e=>{if(!e.target.closest("#chat-context-menu"))closeChatContextMenu();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeChatContextMenu();});
$("context-open-chat")?.addEventListener("click",()=>{const chat=chats.find(c=>c.id===$("chat-context-menu").dataset.chatId);closeChatContextMenu();if(chat)selectChat(chat);});
$("context-pin-chat")?.addEventListener("click",()=>{const id=$("chat-context-menu").dataset.chatId;let ids=getPinnedChats();ids=ids.includes(id)?ids.filter(x=>x!==id):[id,...ids];localStorage.setItem(CHAT_PIN_KEY,JSON.stringify(ids));closeChatContextMenu();renderChats();toast(ids.includes(id)?"Chat pinned.":"Chat unpinned.");});
$("context-mute-chat")?.addEventListener("click",()=>{const id=$("chat-context-menu").dataset.chatId,key="quietchat-muted-chats-"+user.id;let ids=[];try{ids=JSON.parse(localStorage.getItem(key)||"[]");}catch{}const muted=ids.includes(id);ids=muted?ids.filter(x=>x!==id):[...ids,id];localStorage.setItem(key,JSON.stringify(ids));closeChatContextMenu();toast(muted?"Notifications unmuted.":"Notifications muted.");});
$("context-remove-chat")?.addEventListener("click",async()=>{const id=$("chat-context-menu").dataset.chatId;const chat=chats.find(c=>c.id===id);closeChatContextMenu();if(!chat)return;await selectChat(chat);$("chat-remove-btn").click();});
$("context-report-chat")?.addEventListener("click",()=>{const id=$("chat-context-menu").dataset.chatId,chat=chats.find(c=>c.id===id);closeChatContextMenu();if(!chat)return;const subject=encodeURIComponent("QuietChat report: "+chat.title),body=encodeURIComponent("QuietChat report\nChat: "+chat.title+"\nChat ID: "+chat.id+"\nType: "+(chat.isGroup?"Community":"Private chat")+"\nReported by: "+(username||"Unknown")+"\n\nPlease review this report.");window.location.href="mailto:imandrewbrake@gmail.com?subject="+subject+"&body="+body;});
function renderChats(){
  const servers=$("server-list"),list=$("chat-list");
  if(!servers||!list)return;
  servers.replaceChildren();list.replaceChildren();
  const pinned=getPinnedChats();const orderPinned=(items)=>items.sort((a,b)=>Number(pinned.includes(b.id))-Number(pinned.includes(a.id)));const groups=orderPinned(chats.filter(chat=>chat.isGroup)),directs=orderPinned(chats.filter(chat=>!chat.isGroup));
  if(!groups.length){const d=document.createElement("div");d.className="empty-small server-empty";d.textContent="No servers yet. Join or create a community.";servers.append(d);}
  if(!directs.length){const d=document.createElement("div");d.className="empty-small";d.textContent="No private chats yet.";list.append(d);}
  const renderOne=(chat,target)=>{
    const b=document.createElement("button");b.className="chat-item"+(activeChat?.id===chat.id?" active":"");
    if(chat.isGroup)b.classList.add("server-item");
    const av=document.createElement("div");av.className="avatar";av.textContent=initials(chat.title);
    if(chat.isGroup&&chat.logoPath){db.storage.from("chat-media").createSignedUrl(chat.logoPath,3600).then(({data,error})=>{if(!error&&data?.signedUrl){const img=document.createElement("img");img.src=data.signedUrl;img.alt="Community logo";img.className="profile-avatar-img";av.replaceChildren(img);}});}
    const t=document.createElement("div");t.className="chat-item-text";
    const strong=document.createElement("strong");strong.textContent=chat.title;
    const preview=document.createElement("span");preview.className="preview";preview.textContent=chat.isGroup?`${chat.memberCount} members · Community`:chat.memberCount<2?"Invite sent · waiting to join":"Private conversation";
    t.append(strong,preview);b.append(av,t);b.dataset.chatId=chat.id;b.addEventListener("click",()=>selectChat(chat));b.addEventListener("contextmenu",e=>{e.preventDefault();e.stopPropagation();showChatContextMenu(e,chat);});target.append(b);
    const memberData=rowProfileForChat(chat.id);
    if(!chat.isGroup&&memberData?.avatar_path){db.storage.from("profile-pics").createSignedUrl(memberData.avatar_path,3600).then(({data,error})=>{if(!error&&data?.signedUrl){const img=document.createElement("img");img.src=data.signedUrl;img.alt="";img.className="profile-avatar-img";av.replaceChildren(img);}});}
  };
  groups.forEach(chat=>renderOne(chat,servers));directs.forEach(chat=>renderOne(chat,list));
}
let emptyChatInviteRequest=0;
async function showEmptyChatInvite(chat,messageCount){
  const panel=$("empty-chat-invite"),controls=$("empty-chat-invite-controls");
  if(!panel)return;
  panel.classList.add("hidden");controls?.classList.add("hidden");
  if(messageCount>0||!chat)return;
  const request=++emptyChatInviteRequest;
  panel.classList.remove("hidden");
  $("empty-chat-invite-note").textContent=chat.isGroup
    ?"This community has no messages yet. Share an invite link so people can join."
    :"This private chat has no messages yet. Share the link with one person to start your one-on-one chat.";
  $("empty-chat-invite-note").dataset.status="loading";
  $("empty-chat-invite-note").textContent+=" Creating an invite link…";
  const {data,error}=await db.rpc("create_chat_invite_for",{target_chat:chat.id});
  if(request!==emptyChatInviteRequest||activeChat?.id!==chat.id)return;
  if(error){
    $("empty-chat-invite-note").textContent=error.message?.includes("already has two people")
      ?"This one-on-one chat already has two people, so it cannot invite a third person."
      :"Couldn't create an invite link: "+error.message;
    return;
  }
  const code=String(data||"").trim().toUpperCase();
  const link=window.location.origin+window.location.pathname+"?invite="+encodeURIComponent(code);
  $("empty-chat-invite-code").textContent=code;
  $("empty-chat-invite-link").value=link;
  controls?.classList.remove("hidden");
}
$("empty-chat-copy-code")?.addEventListener("click",()=>copyInviteText($("empty-chat-invite-code").textContent,"Invite code"));
$("empty-chat-copy-link")?.addEventListener("click",()=>copyInviteText($("empty-chat-invite-link").value,"Invite link"));
async function selectChat(chat){
  activeChat=chat;emptyChatInviteRequest++;$("empty-chat-invite")?.classList.add("hidden");try{localStorage.setItem("quietchat-last-chat-"+user.id,chat.id);}catch{};$("app-screen").classList.add("chat-open");$("chat-title").textContent=chat.title;$("chat-subtitle").textContent=chat.isGroup?`${chat.isAdult?"🔞 18+ · ":""}${chat.memberCount} members · Messages are live`:(chat.bio||"Private chat · messages are live");$("chat-avatar").textContent=chat.isGroup?"👥":initials(chat.title);if(chat.logoPath){db.storage.from("chat-media").createSignedUrl(chat.logoPath,3600).then(({data,error})=>{if(!error&&data?.signedUrl&&activeChat?.id===chat.id){const img=document.createElement("img");img.src=data.signedUrl;img.alt="Community logo";img.className="profile-avatar-img";$("chat-avatar").replaceChildren(img);}});}$("chat-notification-btn").textContent=(()=>{try{return JSON.parse(localStorage.getItem("quietchat-muted-chats-"+user.id)||"[]").includes(chat.id)?"🔕 Muted":"🔔 Notifications";}catch{return "🔔 Notifications";}})();
  $("chat-remove-btn").textContent=chat.isGroup?"Leave group":"Remove chat";$("chat-remove-btn").disabled=!!user?.is_anonymous&&chat.isGroup;  $("welcome-panel").classList.add("hidden");$("messages").classList.remove("hidden");$("composer-wrap").classList.remove("hidden");$("call-btn").disabled=!!chat.isGroup;$("call-btn").classList.toggle("hidden",!!chat.isGroup);$("settings-export-btn").disabled=false;$("game-btn").disabled=!!chat.isGroup;$("game-btn").classList.toggle("hidden",!!chat.isGroup);document.querySelectorAll('[data-menu-action="games"]').forEach(b=>b.classList.toggle("hidden",!!chat.isGroup));$("add-people-btn").classList.toggle("hidden",!chat.isGroup);$("add-people-btn").disabled=false;$("group-settings-btn")?.classList.toggle("hidden",!chat.isGroup);renderChats();
  requestAnimationFrame(()=>{const item=document.querySelector(`[data-chat-id="${CSS.escape(chat.id)}"]`);item?.scrollIntoView({block:"nearest"});});
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
      hydrateAndRenderMessage(payload.new);
    })
    .subscribe();
  await loadMessages();
  if(activeChat?.id===selectedChatId){const count=$("messages").querySelectorAll(".message").length;await showEmptyChatInvite(chat,count);}
  // Poll the newest messages every 2.5 seconds as a reliable fallback for missed realtime events.
  messageRefreshTimer=setInterval(()=>refreshActiveChatMessages(selectedChatId),2500);
}
async function hydrateAndRenderMessage(message){
  if(!message||!activeChat||message.chat_id!==activeChat.id)return;
  if(!message.profiles&&message.sender_id){const {data}=await db.from("profiles").select("username").eq("id",message.sender_id).maybeSingle();if(data)message={...message,profiles:data};}
  if(message.sender_id===user?.id)message={...message,profiles:{username:username}};
  renderMessage(message);
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
    hydrateAndRenderMessage(m);
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
  $("empty-chat-invite")?.classList.add("hidden");
  const date=new Date(m.created_at),dayKey=date.toLocaleDateString();
  if(dayKey!==lastRenderedDay){const label=document.createElement("div");label.className="day-label";label.textContent=date.toLocaleDateString([], {weekday:"long",month:"long",day:"numeric",year:"numeric"});$("messages").append(label);lastRenderedDay=dayKey;}
  const mine=m.sender_id===user.id,wrap=document.createElement("article");wrap.className="message"+(mine?" mine":"");wrap.dataset.messageId=m.id;
  const meta=document.createElement("div");meta.className="message-meta";const who=document.createElement("span");who.textContent=mine?"You":(m.profiles?.username||"Friend");const time=document.createElement("span");time.textContent=niceTime(m.created_at);time.title=date.toLocaleString();meta.append(who,time);
  const bubble=document.createElement("div");bubble.className="bubble";wrap.append(meta,bubble);$("messages").append(wrap);
  if(m.attachment_path){
    const cached=await localMediaGet(m.id).catch(()=>null);
    let mediaUrl=cached?URL.createObjectURL(cached.blob):null;
    if(!mediaUrl){
      if(String(m.attachment_path).startsWith("r2:")){
        const {data:ticket,error}=await db.functions.invoke("r2-media",{body:{action:"download",chatId:m.chat_id,path:m.attachment_path.slice(3)}});
        if(!error&&ticket?.url){mediaUrl=ticket.url;cacheMedia(m,mediaUrl);}
      }else{
        const {data:media,error}=await db.storage.from("chat-media").createSignedUrl(m.attachment_path,3600);
        if(!error&&media?.signedUrl){mediaUrl=media.signedUrl;cacheMedia(m,mediaUrl);}
      }
    }
    if(mediaUrl){
      if(m.attachment_type==="image"){const img=document.createElement("img");img.src=mediaUrl;img.alt=m.attachment_name||"Photo sent in chat";img.className="chat-media-image";img.loading="lazy";img.addEventListener("click",()=>{const v=window.open("","_blank","noopener");if(v){const image=v.document.createElement("img");image.src=img.src;image.style="max-width:100%;height:auto";v.document.body.append(image);}});bubble.append(img);}
      else if(m.attachment_type==="video"){const video=document.createElement("video");video.src=mediaUrl;video.controls=true;video.preload="metadata";video.className="chat-media-video";bubble.append(video);}
      else if(m.attachment_type==="audio"){const audio=document.createElement("audio");audio.src=mediaUrl;audio.controls=true;audio.preload="metadata";audio.className="chat-media-audio";audio.setAttribute("aria-label","Voice memo");bubble.append(audio);}
      else if(m.attachment_type==="file"){const a=document.createElement("a");a.href=mediaUrl;a.target="_blank";a.rel="noopener";a.download=m.attachment_name||"download";a.className="chat-file-link";a.textContent="📎 "+(m.attachment_name||"Download file");bubble.append(a);}
    }else{const unavailable=document.createElement("span");unavailable.textContent="Media unavailable";bubble.append(unavailable);}
  }
  if(m.body&&!((m.attachment_type==="image"&&m.body==="📷 Photo")||(m.attachment_type==="video"&&m.body==="🎬 Video")||(m.attachment_type==="audio"&&m.body==="🎙 Voice memo"))){const caption=document.createElement("div");linkifyText(filterCussing(m.body),caption);bubble.append(caption);}
  // Cyberbullying safety: let users prepare a report without silently sending private chat data anywhere.
  if(!mine){const safety=document.createElement("div");safety.className="message-safety-actions";safety.style.cssText="display:flex;justify-content:flex-end;gap:8px;margin-top:6px";const report=document.createElement("button");report.type="button";report.className="tiny secondary";report.textContent="⚑ Report";report.setAttribute("aria-label","Report this message for bullying or abuse");report.addEventListener("click",async()=>{const reason=prompt("Why are you reporting this message?\\n\\nExamples: cyberbullying, threats, harassment, or inappropriate content.");if(!reason||!reason.trim())return;const reportText="QuietChat safety report\\nReason: "+reason.trim()+"\\nSender: "+(m.profiles?.username||"Friend")+"\\nDate: "+date.toLocaleString()+"\\nChat: "+(activeChat?.name||activeChat?.title||"Current chat")+"\\nMessage: "+(m.body||"[attachment: "+(m.attachment_name||m.attachment_type||"media")+"]")+"\\nMessage ID: "+m.id+"\\n\\nThis report was prepared on this device; it has NOT been sent to QuietChat.";try{await navigator.clipboard.writeText(reportText);alert("Report copied. It has not been sent anywhere. Share it with a trusted adult or the person who manages this community, and keep screenshots if you feel unsafe.");}catch{prompt("Copy this report and share it with a trusted adult or community manager:",reportText);}});safety.append(report);wrap.append(safety);}
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
  if(activeChat.isGroup && (!user?.email || user.is_anonymous)){
    toast("Use an email-based account to upload attachments in communities. Link your account in Settings.");
    $("media-input").value="";
    return;
  }
  if(activeChat.isGroup && (!user?.email || user.is_anonymous)){
    toast("Use an email-based account to upload attachments in communities. Link your account in Settings.");
    $("media-input").value="";
    return;
  }
  // Community uploads: QuietChat admins can upload arbitrary files in communities they created. Other communities are GIF-only.
  if(activeChat.isGroup && !(isQuietChatAdmin() && activeChat.createdBy===user?.id) && !isGifFile(file)){
    toast("This community only allows GIF uploads. Full file uploads are enabled only in communities created by a QuietChat admin.");
    $("media-input").value="";
    return;
  }
  if(file.size>5*1024*1024){toast("That file is too big. The limit is 5 MB.");$("media-input").value="";return;}
  let ext=(file.name?.split(".").pop()||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8);
  if(!ext) ext=type==="audio"?(file.type.includes("mp4")?"m4a":file.type.includes("ogg")?"ogg":"webm"):type==="video"?"mp4":type==="image"?"jpg":"bin";
  const chatId=activeChat.id;
  let path="";
  toast(actualType==="audio"?"Sending voice memo…":"Uploading file…");
  const contentType=(file.type|| (type==="audio"?"audio/webm":"application/octet-stream")).split(";")[0];
  try {
    const formData=new FormData();
    formData.append("action","upload");
    formData.append("chatId",chatId);
    formData.append("fileName",file.name||"attachment");
    formData.append("contentType",contentType);
    formData.append("file",file,file.name||"attachment");
    const {data:ticket,error:ticketError}=await db.functions.invoke("r2-media",{body:formData});
    if(ticketError||!ticket?.uploaded||!ticket?.path){
      console.error("R2 upload failed",ticketError,ticket);
      toast("Upload failed: "+(ticketError?.message||ticket?.error||"check the r2-media function and R2 credentials"));
      $("media-input").value="";return;
    }
    path="r2:"+ticket.path;
    const body=actualType==="image"?"📷 Photo":actualType==="video"?"🎬 Video":actualType==="audio"?"🎙 Voice memo":"📎 File: "+file.name.slice(0,180);
    const {error}=await db.from("messages").insert({chat_id:chatId,sender_id:user.id,body,attachment_path:path,attachment_type:actualType,attachment_name:file.name.slice(0,255)});
    if(error){console.error("Message save after upload failed",error);toast("Uploaded, but the message failed to save: "+error.message);}
    else toast(actualType==="audio"?"Voice memo sent!":actualType==="image"?"Photo sent!":actualType==="video"?"Video sent!":"File sent!");
  } catch(err) {
    console.error("Attachment upload error",err);
    toast("Upload error: "+(err?.message||"check your connection and R2 settings"));
  } finally {
    $("media-input").value="";
  }
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

$("create-group-btn").addEventListener("click",()=>{if(!user){toast("Please sign in first.");showSetup(false);return;}if(user.is_anonymous){toast("Guest accounts can chat, but creating groups requires a registered account.");return;}openDialog("group-dialog");});
$("group-form").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!user||!db){toast("Please sign in again, then try creating the group.");return;}
  if(user.is_anonymous){toast("Guest accounts cannot create groups. Create an account first.");return;}
  const name=cleanName($("group-name-input").value);
  if(name.length<2){toast("Group name must have at least 2 characters.");return;}
  const btn=e.submitter||$("group-form").querySelector('button[type="submit"]');
  if(btn)btn.disabled=true;
  try{
    const {data,error}=await db.rpc("create_group_chat",{group_name:name,is_public:false,group_description:"",is_adult:$("group-is-adult")?.checked||false});
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
  setInviteDetails(data);openDialog("invite-dialog");
});

async function copyInviteText(value,label){
  try{
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);}
    else{
      const field=document.createElement("textarea");field.value=value;field.setAttribute("readonly","");field.style.position="fixed";field.style.opacity="0";document.body.append(field);field.select();
      const copied=document.execCommand("copy");field.remove();if(!copied)throw new Error("Copy not available");
    }
    toast(label+" copied!");
  }catch(error){
    const field=document.createElement("textarea");field.value=value;field.style.width="100%";field.style.minHeight="70px";field.style.marginTop="8px";
    const host=$("invite-copy-fallback");if(host){host.replaceChildren(document.createTextNode("Copy this "+label.toLowerCase()+":"),field);field.focus();field.select();}
    toast("Select the text and copy it.");
  }
}
function setInviteDetails(code){
  window.currentInviteCode=String(code||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  window.currentInviteUrl=window.location.origin+window.location.pathname+"?invite="+encodeURIComponent(window.currentInviteCode);
  $("invite-code").textContent=window.currentInviteCode;
  $("invite-link").value=window.currentInviteUrl;
  $("invite-copy-fallback")?.replaceChildren();
}
async function handleInviteLink(){
  const params=new URLSearchParams(window.location.search),code=params.get("invite");
  if(!code)return;
  const normalized=code.toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(normalized.length!==10){toast("That invite link does not contain a valid 10-character code.");return;}
  $("invite-input").value=normalized;openDialog("join-dialog");
  await joinWithInviteRetries(normalized,8);
}
async function joinWithInviteRetries(code,maxAttempts=8){
  const input=$("invite-input"),submit=$("join-form")?.querySelector('button[type="submit"]');
  if(submit)submit.disabled=true;
  try{
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      const {data,error}=await db.rpc("join_chat_with_invite",{invite_code:code});
      if(!error){
        closeDialog("join-dialog");input.value="";
        const cleanUrl=new URL(window.location.href);cleanUrl.searchParams.delete("invite");
        window.history.replaceState({},document.title,cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
        await loadChats();const chat=chats.find(c=>c.id===data);if(chat)selectChat(chat);
        toast("Invite opened — you joined the chat!");return true;
      }
      const message=String(error.message||"");
      if(!/fetch|network|timeout|temporar|502|503|504|500/i.test(message)){
        toast("Invite could not open: "+message);return false;
      }
      if(attempt<maxAttempts){toast("Connection hiccup — retrying invite ("+attempt+"/"+maxAttempts+")…");await new Promise(resolve=>setTimeout(resolve,1200));}
    }
    toast("Couldn't connect to open that invite. Check your internet and tap Join again.");return false;
  }finally{if(submit)submit.disabled=false;}
}
async function createInvite(){
  const btns=[$("create-invite-btn"),$("new-chat-btn"),$("welcome-create")];btns.forEach(b=>b.disabled=true);
  try{
    const {data,error}=await db.rpc("create_chat_invite");
    if(error){toast("Couldn't create invite: "+error.message);return;}
    setInviteDetails(data);openDialog("invite-dialog");await loadChats();
  }finally{btns.forEach(b=>b.disabled=false);}
}
$("create-invite-btn").addEventListener("click",createInvite);$("new-chat-btn").addEventListener("click",createInvite);$("welcome-create").addEventListener("click",createInvite);
$("copy-code-btn").addEventListener("click",()=>copyInviteText(window.currentInviteCode||$("invite-code").textContent,"Invite code"));
$("copy-link-btn").addEventListener("click",()=>copyInviteText(window.currentInviteUrl||$("invite-link").value,"Invite link"));
$("invite-done-btn").addEventListener("click",()=>closeDialog("invite-dialog"));
$("join-invite-btn").addEventListener("click",()=>openDialog("join-dialog"));
$("join-form").addEventListener("submit",async e=>{
  e.preventDefault();const code=$("invite-input").value.trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(code.length!==10){toast("Invite codes must be 10 characters.");return;}
  await joinWithInviteRetries(code,8);
});

$("chat-remove-btn")?.addEventListener("click",async()=>{
  if(!activeChat||!user)return;
  if(user.is_anonymous&&activeChat.isGroup){toast("Guest accounts cannot leave groups yet. Sign in with a registered account to leave this group.");return;}
  const chat=activeChat;
  const action=chat.isGroup?"leave this group":"remove this chat from your list";
  if(!window.confirm("Are you sure you want to "+action+"? This removes your membership. It does not delete the other person's copy."))return;
  const {error}=await db.rpc("quietchat_remove_chat",{target_chat:chat.id});
  if(error){toast("QuietChat could not remove this chat: "+error.message);return;}
  if(messageChannel){db.removeChannel(messageChannel);messageChannel=null;}
  if(messageRefreshTimer){clearInterval(messageRefreshTimer);messageRefreshTimer=null;}
  activeChat=null;
  try{localStorage.removeItem("quietchat-last-chat-"+user.id);}catch{}
  $("app-screen").classList.remove("chat-open");
  $("chat-title").textContent="Your messages";
  $("chat-subtitle").textContent="Choose a chat or start a new one";
  $("messages").replaceChildren();$("messages").classList.add("hidden");$("composer-wrap").classList.add("hidden");$("welcome-panel").classList.remove("hidden");
  await loadChats();
  toast("Chat removed from your list.");
});

function applyAppearanceSettings(){
  const root=document.documentElement;
  const ui=localStorage.getItem("quietchat-ui-version")||"fresh";
  let mode=localStorage.getItem("quietchat-device-mode")||"auto";
  const accent=localStorage.getItem("quietchat-accent-color")||"#8b7cff";
  const sidebarPosition=localStorage.getItem("quietchat-sidebar-position")||"left";
  // Reject PC mode when the actual viewport is too narrow; revert immediately.
  if(mode==="pc" && window.innerWidth<900){mode="auto";localStorage.setItem("quietchat-device-mode","auto");}
  root.dataset.ui=ui;root.dataset.deviceMode=mode;root.dataset.sidebarPosition=sidebarPosition;root.style.setProperty("--accent",accent);
  document.body.classList.toggle("pc-layout",mode==="pc");
  document.body.classList.toggle("compact-layout",mode==="mobile");
  if($("settings-ui-version"))$("settings-ui-version").value=ui;
  if($("settings-device-mode"))$("settings-device-mode").value=mode;
  if($("settings-sidebar-position"))$("settings-sidebar-position").value=sidebarPosition;
  if($("settings-accent-color"))$("settings-accent-color").value=accent;
}
$("settings-ui-version")?.addEventListener("change",e=>{localStorage.setItem("quietchat-ui-version",e.target.value);applyAppearanceSettings();});
$("settings-device-mode")?.addEventListener("change",e=>{
  if(e.target.value==="pc"&&window.innerWidth<900){e.target.value="auto";localStorage.setItem("quietchat-device-mode","auto");applyAppearanceSettings();toast("PC mode needs a screen at least 900px wide. Reverted to Automatic.");return;}
  localStorage.setItem("quietchat-device-mode",e.target.value);applyAppearanceSettings();
});
$("settings-accent-color")?.addEventListener("input",e=>{localStorage.setItem("quietchat-accent-color",e.target.value);applyAppearanceSettings();});
$("settings-sidebar-position")?.addEventListener("change",e=>{localStorage.setItem("quietchat-sidebar-position",e.target.value);applyAppearanceSettings();});
window.addEventListener("resize",()=>{if(localStorage.getItem("quietchat-device-mode")==="pc"&&window.innerWidth<900){localStorage.setItem("quietchat-device-mode","auto");applyAppearanceSettings();toast("PC mode did not fit, so QuietChat reverted to Automatic.");}});
applyAppearanceSettings();
$("settings-btn").addEventListener("click",()=>{updateAccountLinkButton();updateGoogleLinkButton();openDialog("settings-dialog");});
function openAccountSettings(){closeDialog("profile-dialog");openDialog("settings-dialog");}
$("my-avatar")?.addEventListener("click",openAccountSettings);
$("my-avatar")?.setAttribute("title","Open profile and settings");
$("my-avatar")?.setAttribute("role","button");
$("my-avatar")?.setAttribute("tabindex","0");
$("my-avatar")?.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openAccountSettings();}});

function updateAccountLinkButton(){const guest=!!user?.is_anonymous;$("settings-link-account-btn")?.classList.remove("hidden");$("settings-link-account-help")?.classList.remove("hidden");$("settings-link-account-btn").textContent=guest?"🔗 Link a real account":"Account already linked";$("settings-link-account-btn").disabled=!guest;$("settings-link-account-help").textContent=guest?"Upgrade this guest account with an email and password. Your existing chats stay on this account.":"This account is already linked. Sign in with this account on another device to access its chats.";}
function updateGoogleLinkButton(){const guest=!!user?.is_anonymous;const b=$("settings-link-google-btn"),help=$("settings-link-google-help");if(!b)return;b.classList.remove("hidden");if(guest){b.disabled=false;b.textContent="G Link Google account (optional)";if(help)help.textContent="Optional: connect Google to this guest account so your existing chats stay attached.";}else{b.disabled=true;b.textContent="Google linking available for guest accounts";if(help)help.textContent="If you signed in with Google already, your Google account is connected. Other signed-in accounts cannot be merged automatically.";}}
$("settings-link-account-btn")?.addEventListener("click",()=>{if(!user?.is_anonymous){toast("This account is already linked. You don't need to make another account.");return;}closeDialog("settings-dialog");$("link-account-email").value="";$("link-account-password").value="";openDialog("link-account-dialog");});
$("settings-link-google-btn")?.addEventListener("click",async()=>{if(!user?.is_anonymous){toast("Google can only be linked to your current guest account here. Accounts cannot be merged automatically.");return;}if(!db?.auth?.linkIdentity){toast("Google linking is not supported by the current auth setup. You can still link email and password.");return;}const {error}=await db.auth.linkIdentity({provider:"google",options:{redirectTo:window.location.origin}});if(error)toast("Could not start Google linking: "+error.message+". Check that Google sign-in is enabled in Supabase.");});
let linkAccountMode="signup";
function setLinkAccountMode(mode){
  linkAccountMode=mode;
  const signingIn=mode==="signin";
  $("link-account-mode-copy").textContent=signingIn?"Need a new account?":"Already have an account?";
  $("link-account-mode-btn").textContent=signingIn?"Create account instead":"Sign in instead";
  $("link-account-submit").textContent=signingIn?"Sign in →":"Create account and save chats →";
  $("link-account-password").autocomplete=signingIn?"current-password":"new-password";
  $("link-account-password").minLength=signingIn?0:8;
  $("link-account-password").placeholder=signingIn?"Your password":"At least 8 characters";
}
$("link-account-mode-btn")?.addEventListener("click",()=>setLinkAccountMode(linkAccountMode==="signin"?"signup":"signin"));
$("link-account-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("link-account-email").value.trim(),password=$("link-account-password").value;
  if(linkAccountMode==="signin"&&user?.is_anonymous&&!window.confirm("Signing in will switch to the existing account. Chats belonging to this guest account will NOT merge into it. To keep these chats, choose Create account instead. Continue?"))return;
  if(linkAccountMode==="signup"&&!user?.is_anonymous){toast("This account is already linked. Sign out first if you need another account.");return;}
  if(linkAccountMode==="signup"&&password.length<8){toast("Use a password with at least 8 characters.");return;}
  const btn=$("link-account-submit");btn.disabled=true;btn.textContent=linkAccountMode==="signin"?"Signing in…":"Creating account…";
  try{
    const result=linkAccountMode==="signin"
      ? await db.auth.signInWithPassword({email,password})
      : await db.auth.updateUser({email,password});
    if(result.error){toast((linkAccountMode==="signin"?"Sign-in failed: ":"Couldn't create/link account: ")+result.error.message);return;}
    if(linkAccountMode==="signup"){
      user=result.data.user||user;
      $("account-label").textContent=user.email||"Account linked — confirm email";
      closeDialog("link-account-dialog");updateAccountLinkButton();
      toast("Your guest account is being upgraded, so its chats stay attached. Keep this browser data until any email confirmation is complete.");
    }else{
      closeDialog("link-account-dialog");
      toast("Signed in. Existing account chats are loading.");
      location.reload();
    }
  }catch(err){toast("Couldn't complete that action: "+(err?.message||"Please try again."));}
  finally{btn.disabled=false;setLinkAccountMode(linkAccountMode);}
});

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
  if(chat.isGroup){toast("Video calls are only available in private chats, not communities.");return;}
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
$("game-btn").addEventListener("click",()=>{
  const frame=$("game-night-frame");
  if(frame&&(!frame.getAttribute("src")||frame.getAttribute("src")==="about:blank"))frame.src="/games/";
  openDialog("game-dialog");
});
document.querySelectorAll("[data-embed-game]").forEach(button=>button.addEventListener("click",()=>{
  const frame=$("game-night-frame");
  const game=button.dataset.embedGame;
  if(frame)frame.src="https://playbolt.app/play/"+encodeURIComponent(game)+"/";
}));
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
 $("communities-btn")?.addEventListener("click",()=>{openDialog("communities-dialog");showCommunityView("public");loadPublicCommunities();});
 $("sidebar-discover-btn")?.addEventListener("click",()=>{openDialog("communities-dialog");showCommunityView("public");loadPublicCommunities();});
 async function loadMyCommunities(){
   const list=$("community-list");if(!list)return;
   if(!user){list.innerHTML='<div class="community-empty"><strong>Sign in to view your communities</strong></div>';return;}
   await loadChats();const groups=chats.filter(c=>c.isGroup);list.replaceChildren();
   if(!groups.length){list.innerHTML='<div class="community-empty"><strong>No communities yet</strong><p class="muted">Create a private community or accept an invite from a friend.</p></div>';return;}
   groups.forEach(g=>{const card=document.createElement("article");card.className="discover-group-card";const details=document.createElement("div");details.className="discover-group-details";const title=document.createElement("strong");title.textContent=g.title;const meta=document.createElement("small");meta.textContent=(g.isAdult?"🔞 18+ · ":"")+(g.memberCount||1)+" members · "+(g.isPublic?"Public":"Private");details.append(title,meta);const btn=document.createElement("button");btn.className="primary discover-join";btn.type="button";btn.textContent="Open";btn.addEventListener("click",()=>{closeDialog("communities-dialog");selectChat(g);});card.append(details,btn);list.append(card);});
 }
 function showCommunityView(view){document.querySelectorAll("[data-community-view]").forEach(btn=>btn.classList.toggle("active",btn.dataset.communityView===view));["discover","public","create"].forEach(n=>$("community-"+n+"-panel")?.classList.toggle("hidden",n!==view));}
 $("refresh-communities-btn")?.addEventListener("click",loadMyCommunities);
 async function loadPublicCommunities(){
   const list=$("public-community-list");if(!list)return;list.replaceChildren();
   const {data,error}=await db.rpc("discover_public_groups");
   if(error){list.innerHTML='<div class="community-empty"><strong>Public group listing needs a database update</strong><p class="muted tiny">The secure list_public_groups database function is not available yet.</p></div>';return;}
   if(!Array.isArray(data)||!data.length){list.innerHTML='<div class="community-empty"><strong>No public communities found</strong></div>';return;}
   data.forEach(g=>{const card=document.createElement("article");card.className="discover-group-card";const details=document.createElement("div");details.className="discover-group-details";const title=document.createElement("strong");title.textContent=g.name||g.group_name||"Public community";const meta=document.createElement("small");meta.textContent=(g.is_adult?"🔞 18+ · ":"")+(g.description?g.description+" · ":"")+"Public · Text and GIFs only · "+g.member_count+" members";details.append(title,meta);const btn=document.createElement("button");btn.className="primary discover-join";btn.type="button";btn.textContent=g.is_member?"Open community":"Join community";btn.addEventListener("click",async()=>{if(g.is_adult&&!window.confirm("🔞 ADULTS-ONLY GROUP (18+). This community is intended only for adults. If you are under 18, do not join. Continue only if you are 18 or older and understand this group is marked 18+. Do you want to continue?"))return;if(!g.is_member){const {error:joinError}=await db.rpc("join_public_group",{target_chat:g.id||g.chat_id,confirm_adult:!!g.is_adult});if(joinError){toast("Could not join: "+joinError.message);return;}toast("You joined the community!");}await loadChats();await loadPublicCommunities();const chat=chats.find(x=>x.id===(g.id||g.chat_id));if(chat){closeDialog("communities-dialog");selectChat(chat);}});card.append(details,btn);list.append(card);});
 }
 $("refresh-public-communities-btn")?.addEventListener("click",loadPublicCommunities);
 document.querySelectorAll("[data-community-view]").forEach(btn=>btn.addEventListener("click",()=>{showCommunityView(btn.dataset.communityView);if(btn.dataset.communityView==="discover")loadMyCommunities();if(btn.dataset.communityView==="public")loadPublicCommunities();}));
 $("community-create-form")?.addEventListener("submit",async ev=>{
  ev.preventDefault();
  if(!user||!db){toast("Please sign in first, then try again.");return;}
  if(!user.email || user.is_anonymous){toast("Creating a community requires an email-based account. Link your account in Settings first.");return;}
  const name=cleanName($("community-name").value);
  if(name.length<2){toast("Group name needs at least 2 characters.");return;}
  const form= $("community-create-form"),btn=form.querySelector('button[type="submit"]');
  if(btn)btn.disabled=true;
  try{
    const isPublic=$("community-is-public")?.checked||false;
    const description=$("community-description")?.value||"";
    const isAdult=$("community-is-adult")?.checked||false;
    const {data,error}=await db.rpc("create_group_chat",{group_name:name,is_public:isPublic,group_description:description,is_adult:isAdult});
    if(error){toast("Could not create community: "+error.message+". If the function is missing, run the latest supabase-setup.sql in Supabase.");return;}
    toast(isPublic?"Public community created!":"Private community created! Use Add people to invite friends.");
    form.reset();closeDialog("communities-dialog");await loadChats();
    const chat=chats.find(c=>c.id===data);if(chat)await selectChat(chat);
  }catch(err){toast("Could not create community: "+(err?.message||"please try again."));}
  finally{if(btn)btn.disabled=false;}
});
 $("save-group-settings")?.addEventListener("click",async()=>{
  if(!activeChat?.isGroup)return;
  if(!canManageCommunity(activeChat)){toast("Only the community owner or QuietChat admin can save changes.");return;}
  const isPublic=document.querySelector('input[name="existing-group-visibility"]:checked')?.value==="public";
  const allowGifs=$("group-allow-gifs").checked,removeInactive=$("group-inactivity-rule").checked;
  const newName=cleanName($("group-name-edit").value);
  if(newName.length<2){toast("Community name needs at least 2 characters.");return;}
  let logoPath=null;const file=$("community-logo-input").files?.[0];
  if(file){
    if(!file.type.startsWith("image/")||file.size>5*1024*1024){toast("Choose a logo image smaller than 5 MB.");return;}
    const ext=(file.name.split(".").pop()||"png").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8)||"png";
    logoPath=activeChat.id+"/community-logo-"+crypto.randomUUID()+"."+ext;
    const up=await db.storage.from("chat-media").upload(logoPath,file,{contentType:file.type,upsert:false});
    if(up.error){toast("Logo upload failed: "+up.error.message);return;}
  }
  const {error}=await db.rpc("update_group_settings",{target_chat:activeChat.id,make_public:isPublic,p_allow_gifs:allowGifs,p_remove_inactive:removeInactive,p_name:newName,p_logo_path:logoPath});
  if(error){if(logoPath)await db.storage.from("chat-media").remove([logoPath]);toast("Could not save changes: "+error.message);return;}
  const newOwner=$("transfer-owner-select").value;
  if(newOwner){const transfer=await db.rpc("transfer_group_ownership",{target_chat:activeChat.id,new_owner:newOwner});if(transfer.error){toast("Settings saved, but ownership transfer failed: "+transfer.error.message);}else toast("Community settings saved and ownership transferred.");}
  else toast("Community settings saved.");
  $("community-logo-input").value="";
  await loadChats();const fresh=chats.find(x=>x.id===activeChat.id);if(fresh)await selectChat(fresh);closeDialog("group-settings-dialog");
 });
 $("chat-notification-btn")?.addEventListener("click",()=>{
  if(!activeChat)return;
  const key="quietchat-muted-chats-"+user.id;let muted=[];
  try{muted=JSON.parse(localStorage.getItem(key)||"[]");}catch{}
  const isMuted=muted.includes(activeChat.id);
  muted=isMuted?muted.filter(id=>id!==activeChat.id):[...muted,activeChat.id];
  localStorage.setItem(key,JSON.stringify(muted));
  $("chat-notification-btn").textContent=muted.includes(activeChat.id)?"🔕 Muted":"🔔 Notifications";
  toast(muted.includes(activeChat.id)?"Notifications muted for this chat.":"Notifications enabled for this chat.");
 });
 
 $("group-settings-btn")?.addEventListener("click",async()=>{if(!activeChat?.isGroup)return;if(!canManageCommunity(activeChat)){toast("Only the community owner or QuietChat admin can manage this community.");return;}document.querySelectorAll('input[name="existing-group-visibility"]').forEach(x=>x.checked=(x.value==="public"&&activeChat.isPublic)||(x.value==="private"&&!activeChat.isPublic));$("group-allow-gifs").checked=!!activeChat.allowGifs;$("group-inactivity-rule").checked=activeChat.removeInactive!==false;$("group-name-edit").value=activeChat.title||"";const select=$("transfer-owner-select");select.replaceChildren(new Option("Keep current owner",""));(activeChat.memberIds||[]).filter(m=>m.id!==user.id).forEach(m=>select.add(new Option(m.name,m.id)));openDialog("group-settings-dialog");});
 $("delete-group-btn")?.addEventListener("click",async()=>{if(!activeChat?.isGroup){toast("Open a group first.");return;}if(!canManageCommunity(activeChat)){toast("Only the community owner or QuietChat admin can delete this community.");return;}if(!confirm('Delete "'+activeChat.title+'" and its group chat? This cannot be undone.'))return;const id=activeChat.id;const {error}=await db.rpc("delete_group_chat",{target_chat:id});if(error){toast("Could not delete group: "+error.message+" (secure delete function may need installing)");return;}if(messageChannel){db.removeChannel(messageChannel);messageChannel=null;}activeChat=null;$("app-screen").classList.remove("chat-open");$("welcome-panel").classList.remove("hidden");$("messages").classList.add("hidden");$("composer-wrap").classList.add("hidden");await loadChats();await loadMyCommunities();toast("Group deleted.");});
 $("mobile-back").addEventListener("click",()=>{$("app-screen").classList.remove("chat-open");setSidebarCollapsed(false);});
let onlineChannel=null;
function subscribeOnlineUsers(){
  if(onlineChannel){db.removeChannel(onlineChannel);onlineChannel=null;}
  const countLabel=$("online-count");if(!countLabel)return;
  onlineChannel=db.channel("quietchat-online-presence",{config:{presence:{key:user.id}}})
  .on("presence",{event:"sync"},()=>{
    const state=onlineChannel.presenceState();
    const count=Object.keys(state).filter(id=>id!==user.id).length;
    countLabel.textContent=String(count);
  })
  .subscribe(async status=>{if(status==="SUBSCRIBED")await onlineChannel.track({online_at:new Date().toISOString()});});
}
async function handleInviteLink(){
 const url=new URL(window.location.href),code=url.searchParams.get("invite");
 if(!code||!user)return;
 if(!window.confirm("Before joining: this invite may lead to a group marked 18+. If the group is marked 18+, it is for adults only; do not join if you are under 18. Continue to open this invite?")){url.searchParams.delete("invite");history.replaceState({}, "", url.toString());return;}
 url.searchParams.delete("invite");history.replaceState({}, "", url.toString());
 const {data,error}=await db.rpc("join_chat_with_invite",{invite_code:code.trim().toUpperCase()});
 if(error){toast("Invite link could not be joined: "+error.message);return;}
 await loadChats();const chat=chats.find(c=>c.id===data);if(chat)await selectChat(chat);
}
document.addEventListener("click",e=>{
 const button=e.target.closest("[data-menu-action]");if(!button)return;
 const action=button.dataset.menuAction;button.closest("details")?.removeAttribute("open");
 if(action==="layout-auto"){document.body.classList.remove("pc-layout","compact-layout");localStorage.removeItem("quietchat-layout");}
 if(action==="layout-mobile"){document.body.classList.remove("pc-layout");document.body.classList.add("compact-layout");localStorage.setItem("quietchat-layout","mobile");}
 if(action==="layout-pc"){document.body.classList.remove("compact-layout");document.body.classList.add("pc-layout");localStorage.setItem("quietchat-layout","pc");}
 if(action==="profile-settings"){ updateNotificationButtons?.(); updateCallLocationButtons?.(); openDialog("settings-dialog"); }
 if(action==="notifications")$("chat-notification-btn")?.click();
 if(action==="settings")$("group-settings-btn")?.click();
 if(action==="invite")$("add-people-btn")?.click();
 if(action==="games")$("game-btn")?.click();
});
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



// Choose a compact layout automatically on phones or narrow browser windows; allow manual override.
(function initResponsiveLayout(){
 const saved=localStorage.getItem("quietchat-layout");
 if(saved==="mobile")document.body.classList.add("compact-layout");
 else if(saved==="pc")document.body.classList.add("pc-layout");
 else if(window.matchMedia("(max-width: 600px)").matches)document.body.classList.add("compact-layout");
 window.matchMedia("(max-width: 600px)").addEventListener?.("change",e=>{
  if(localStorage.getItem("quietchat-layout"))return;
  document.body.classList.toggle("compact-layout",e.matches);
  document.body.classList.remove("pc-layout");
 });
})();


// Smooth, collapsible navigation sidebar. Remember the user's choice.
function setSidebarCollapsed(collapsed){
  app.classList.toggle("sidebar-collapsed",collapsed);
  $("close-sidebar-btn")?.setAttribute("aria-expanded",String(!collapsed));
  $("open-sidebar-btn")?.setAttribute("aria-expanded",String(!collapsed));
  try{localStorage.setItem("quietchat-sidebar-collapsed",collapsed?"yes":"no");}catch{}
}
function setSidebarCollapsed(compact){
  app.classList.toggle("sidebar-icons-only",compact);
  app.classList.remove("sidebar-collapsed");
  $("close-sidebar-btn")?.setAttribute("aria-expanded",String(!compact));
  $("open-sidebar-btn")?.setAttribute("aria-expanded",String(!compact));
  try{localStorage.setItem("quietchat-sidebar-collapsed",compact?"yes":"no");}catch{}
}
$("close-sidebar-btn")?.addEventListener("click",()=>{if(document.documentElement.dataset.sidebarPosition==="dropdown"){app.classList.toggle("dropdown-menu-open");return;}setSidebarCollapsed(!app.classList.contains("sidebar-icons-only"));});
$("open-sidebar-btn")?.addEventListener("click",()=>{if(document.documentElement.dataset.sidebarPosition==="dropdown"){app.classList.toggle("dropdown-menu-open");return;}app.classList.remove("chat-open");setSidebarCollapsed(false);});
document.addEventListener("pointerdown",e=>{
  if(document.documentElement.dataset.sidebarPosition!=="dropdown"||!app.classList.contains("dropdown-menu-open"))return;
  if(e.target.closest("#open-sidebar-btn")||e.target.closest(".sidebar"))return;
  app.classList.remove("dropdown-menu-open");
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&document.documentElement.dataset.sidebarPosition==="dropdown")app.classList.remove("dropdown-menu-open");
});

 $("sidebar-logo-toggle")?.addEventListener("click",()=>{if(app.classList.contains("sidebar-icons-only")||app.classList.contains("sidebar-collapsed")){app.classList.remove("chat-open");setSidebarCollapsed(false);}});
try{if(localStorage.getItem("quietchat-sidebar-collapsed")==="yes")setSidebarCollapsed(true);}catch{}
$("settings-compact-sidebar")?.addEventListener("change",e=>setSidebarCollapsed(e.target.checked));
$("settings-auto-scroll")?.addEventListener("change",e=>{try{localStorage.setItem(AUTO_SCROLL_KEY,e.target.checked?"on":"off");}catch{}if(e.target.checked)scrollMessagesToBottom(true);else updateGoBottomButton();});
$("go-to-bottom-btn")?.addEventListener("click",()=>scrollMessagesToBottom(true));
$("messages")?.addEventListener("scroll",updateGoBottomButton,{passive:true});
if($("messages")&&typeof MutationObserver!=="undefined"){new MutationObserver(()=>requestAnimationFrame(updateGoBottomButton)).observe($("messages"),{childList:true,subtree:true});}
window.addEventListener("resize",updateGoBottomButton);
$("settings-btn")?.addEventListener("click",()=>{if($("settings-compact-sidebar"))$("settings-compact-sidebar").checked=app.classList.contains("sidebar-icons-only");if($("settings-auto-scroll"))$("settings-auto-scroll").checked=getAutoScroll();});


// QuietChat Arcade is hosted in this app at /games/.
(function setupGameNight(){
  const byId=id=>document.getElementById(id),frame=byId("game-night-frame");
  byId("game-night-exit")?.addEventListener("click",()=>closeDialog("game-dialog"));
  byId("game-night-send-invite")?.addEventListener("click",async()=>{
    const link=byId("game-night-room-link").value.trim();
    if(!activeChat||!user){toast("Open a chat before sending a game invite.");return;}
    let url;try{url=new URL(link);}catch{toast("Paste a valid Game Night room invite link first.");return;}
    if(url.protocol!=="https:"||(url.hostname!=="gamenight.zone"&&!url.hostname.endsWith(".gamenight.zone"))){toast("Please paste a secure Game Night invite link.");return;}
    const {error}=await db.from("messages").insert({chat_id:activeChat.id,sender_id:user.id,body:"🎮 Join my Game Night room: "+url.href});
    if(error){toast("Couldn't send the invite. Try again.");return;}
    byId("game-night-room-link").value="";await refreshActiveChatMessages(activeChat.id);toast("Game Night invite sent to this chat.");
  });
  byId("game-dialog")?.addEventListener("close",()=>{if(frame)frame.src="about:blank";});
})();
