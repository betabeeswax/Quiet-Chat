/* QuietChat — plain JavaScript + Supabase.
   Put your Supabase Project URL and publishable (or legacy anon) key below.
   Never put a service_role key in browser code. */
const SUPABASE_URL = "https://zdmkuookuljcintzgzrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eIjdkSKcO53agFW0J26A5Q_ENp_-m32";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const $ = (id) => document.getElementById(id);
let db, user, username = "", activeChat = null, chats = [], messageChannel = null, listChannel = null, toastTimer, authMode = "signin", usernameAuthMode = "signin", mediaRecorder = null, recordingChunks = [], recordingChatId = null;

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
function setProfile(name){username=name;$("my-name").textContent=name;$("my-avatar").textContent=initials(name);}
function openDialog(id){$(id).showModal();}
function closeDialog(id){$(id).close();}

async function start(){
  if(!configured){$("config-warning").classList.remove("hidden");return;}
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  const {data,error}=await db.auth.getSession();
  if(error){toast(error.message);return;}
  if(data.session){user=data.session.user;await loadProfile();} else showSetup(false);
  setAuthMode("signin");setUsernameAuthMode("signin");
}
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("username,bio,avatar_path").eq("id",user.id).maybeSingle();
  if(error){toast("Could not load your profile. Check the SQL setup.");showSetup();return;}
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
$("guest-signin-btn").addEventListener("click",()=>{showSetup(true);$("username").focus();});
$("profile-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!configured)return;
  const name=cleanName($("username").value);if(name.length<2){toast("Use at least 2 characters.");return;}
  if(!user){const {data,error}=await db.auth.signInAnonymously();if(error){toast("Guest sign-in failed. Enable Anonymous Sign-Ins in Supabase Auth.");return;}user=data.user;}
  const {error:saveError}=await db.from("profiles").upsert({id:user.id,username:name,bio:""},{onConflict:"id"});
  if(saveError){toast("Could not save username: "+saveError.message);return;}
  setProfile(name);showApp();await loadChats();subscribeChatList();
});
async function loadChats(){
  const {data,error}=await db.from("chat_members").select("chat_id,chats(id,name,created_at,chat_members(user_id,profiles(username,avatar_path,bio)))").eq("user_id",user.id);
  if(error){toast("Couldn't load chats. Check the database SQL.");return;}
  window.chatProfileLookup={};chats=(data||[]).map(row=>{
    const members=(row.chats?.chat_members||[]).filter(m=>m.user_id!==user.id);
    const memberCount=row.chats?.chat_members?.length||1;
    const other=members[0]?.profiles?.username || "Waiting for friend";if(members[0]?.profiles)window.chatProfileLookup[row.chat_id]=members[0].profiles;
    return {id:row.chat_id,created_at:row.chats?.created_at,title:row.chats?.name || other,memberCount,isGroup:Boolean(row.chats?.name),bio:members[0]?.profiles?.bio||""};
  });
  renderChats();
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
    t.append(strong,preview);b.append(av,t);b.addEventListener("click",()=>selectChat(chat));list.append(b);
    const memberData=rowProfileForChat(chat.id);
    if(memberData?.avatar_path){db.storage.from("profile-pics").createSignedUrl(memberData.avatar_path,3600).then(({data,error})=>{if(!error&&data?.signedUrl){const img=document.createElement("img");img.src=data.signedUrl;img.alt="";img.className="profile-avatar-img";av.replaceChildren(img);}});}
  });
}
async function selectChat(chat){
  activeChat=chat;$("app-screen").classList.add("chat-open");$("chat-title").textContent=chat.title;$("chat-subtitle").textContent=chat.isGroup?`${chat.memberCount} members · Messages are live`:(chat.bio||"Private chat · messages are live");$("chat-avatar").textContent=chat.isGroup?"👥":initials(chat.title);
  $("welcome-panel").classList.add("hidden");$("messages").classList.remove("hidden");$("composer-wrap").classList.remove("hidden");$("call-btn").disabled=false;$("export-btn").disabled=false;$("game-btn").disabled=false;$("add-people-btn").classList.toggle("hidden",!chat.isGroup);$("add-people-btn").disabled=false;renderChats();
  if(messageChannel){db.removeChannel(messageChannel);messageChannel=null;}
  // Subscribe before fetching history so a message sent during loading is not missed.
  messageChannel=db.channel("messages-"+chat.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"chat_id=eq."+chat.id},payload=>renderMessage(payload.new)).subscribe();
  await loadMessages();
}
async function loadMessages(){
  const area=$("messages");area.replaceChildren();
  const {data,error}=await db.from("messages").select("id,chat_id,sender_id,body,created_at,attachment_path,attachment_type,attachment_name,profiles(username)").eq("chat_id",activeChat.id).order("created_at",{ascending:true}).limit(500);
  if(error){toast("Couldn't load messages.");return;}
  (data||[]).forEach(renderMessage);area.scrollTop=area.scrollHeight;
}
async function renderMessage(m){
  if(!activeChat||m.chat_id!==activeChat.id)return;
  if($("messages").querySelector(`[data-message-id="${CSS.escape(m.id)}"]`))return;
  const mine=m.sender_id===user.id, wrap=document.createElement("article");wrap.className="message"+(mine?" mine":"");wrap.dataset.messageId=m.id;
  const meta=document.createElement("div");meta.className="message-meta";const who=document.createElement("span");who.textContent=mine?"You":(m.profiles?.username||"Friend");const time=document.createElement("span");time.textContent=niceTime(m.created_at);meta.append(who,time);
  const bubble=document.createElement("div");bubble.className="bubble";
  if(m.attachment_path){
    const {data:media,error}=await db.storage.from("chat-media").createSignedUrl(m.attachment_path,3600);
    if(!error&&media?.signedUrl){
      if(m.attachment_type==="image"){const img=document.createElement("img");img.src=media.signedUrl;img.alt="Photo sent in chat";img.className="chat-media-image";img.loading="lazy";bubble.append(img);}
      else if(m.attachment_type==="video"){const video=document.createElement("video");video.src=media.signedUrl;video.controls=true;video.preload="metadata";video.className="chat-media-video";bubble.append(video);}
      else if(m.attachment_type==="audio"){const audio=document.createElement("audio");audio.src=media.signedUrl;audio.controls=true;audio.preload="metadata";audio.className="chat-media-audio";audio.setAttribute("aria-label","Voice memo");bubble.append(audio);}else if(m.attachment_type==="file"){const a=document.createElement("a");a.href=media.signedUrl;a.target="_blank";a.rel="noopener";a.download=m.attachment_name||"download";a.className="chat-file-link";a.textContent="📎 "+(m.attachment_name||"Download file");bubble.append(a);}
    } else {const unavailable=document.createElement("span");unavailable.textContent="Media unavailable";bubble.append(unavailable);}
  }
  if(m.body && !((m.attachment_type==="image"&&m.body==="📷 Photo")||(m.attachment_type==="video"&&m.body==="🎬 Video")||(m.attachment_type==="audio"&&m.body==="🎙 Voice memo"))){const caption=document.createElement("div");caption.textContent=m.body;bubble.append(caption);}
  wrap.append(meta,bubble);$("messages").append(wrap);$("messages").scrollTop=$("messages").scrollHeight;
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
  if(file.size>5*1024*1024){toast("That file is too big. The limit is 5 MB.");$("media-input").value="";return;}
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
$("voice-memo-btn").addEventListener("click",toggleVoiceRecording);

$("create-group-btn").addEventListener("click",()=>openDialog("group-dialog"));
$("group-form").addEventListener("submit",async e=>{
  e.preventDefault();const name=cleanName($("group-name-input").value);
  if(name.length<2){toast("Group name must have at least 2 characters.");return;}
  const btn=e.submitter; if(btn)btn.disabled=true;
  const {data,error}=await db.rpc("create_group_chat",{group_name:name});
  if(btn)btn.disabled=false;
  if(error){toast("Could not create group. Check that the latest SQL setup has been run.");return;}
  closeDialog("group-dialog");$("group-name-input").value="";await loadChats();const chat=chats.find(c=>c.id===data);if(chat)selectChat(chat);toast("Group created! Use Add people to invite friends.");
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
$("call-btn").addEventListener("click",async()=>{
  if(!activeChat)return;
  // Random room name prevents easy guessing. Jitsi rooms are not end-to-end private by default;
  // share only with the person in this chat.
  const room="QuietChat-"+crypto.randomUUID().replace(/-/g,"").slice(0,24);
  const url="https://meet.jit.si/"+room;
  const {error}=await db.from("messages").insert({chat_id:activeChat.id,sender_id:user.id,body:"📹 Video call: "+url});
  if(error){toast("Could not send call link.");return;}window.open(url,"_blank","noopener,noreferrer");
});
$("change-name-btn").addEventListener("click",()=>{$("new-name").value=username;openDialog("name-dialog");});
$("name-form").addEventListener("submit",async e=>{
  e.preventDefault();const name=cleanName($("new-name").value);if(name.length<2)return;
  const {error}=await db.from("profiles").update({username:name}).eq("id",user.id);
  if(error){toast("Could not change username.");return;}setProfile(name);closeDialog("name-dialog");await loadChats();toast("Username updated.");
});

async function showAvatar(path){
  const {data,error}=await db.storage.from("profile-pics").createSignedUrl(path,3600);
  if(error||!data?.signedUrl)return;
  const av=$("my-avatar");av.textContent="";const img=document.createElement("img");img.src=data.signedUrl;img.alt="Your profile picture";img.className="profile-avatar-img";av.append(img);
}
$("change-name-btn").addEventListener("click",()=>{
  $("profile-username").value=username;$("profile-bio").value=window.myProfile?.bio||"";$("avatar-input").value="";openDialog("profile-dialog");
});
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
$("export-btn").addEventListener("click",exportAllChats);$("profile-export-btn").addEventListener("click",exportAllChats);

let gameChannel=null;
function renderRps(state){
  state=state||{round:1,moves:{},scores:{},last:null};const scores=state.scores||{};
  $("rps-score").textContent=`Round ${state.round||1} · You: ${scores[user.id]||0} · Friend(s): ${Object.entries(scores).filter(([id])=>id!==user.id).reduce((n,[,v])=>n+Number(v||0),0)}`;
  const last=state.last;if(last){const label=id=>id===user.id?"You":"Friend";const move=m=>({rock:"🪨 Rock",paper:"📄 Paper",scissors:"✂️ Scissors"}[m]||m);const winner=last.winner==="tie"?"It's a tie!":label(last.winner)+" won the round!";$("rps-last").textContent=`${label(last.p1)} chose ${move(last.m1)} · ${label(last.p2)} chose ${move(last.m2)}. ${winner}`;}else{$("rps-last").textContent=Object.keys(state.moves||{}).length?"Move received — waiting for your friend…":"Choose rock, paper, or scissors to start.";}
}
async function refreshRps(){if(!activeChat)return;const {data,error}=await db.from("chat_games").select("state").eq("chat_id",activeChat.id).eq("game_type","rps").maybeSingle();if(!error)renderRps(data?.state);}
$("game-btn").addEventListener("click",async()=>{if(!activeChat)return;openDialog("game-dialog");await refreshRps();if(gameChannel)db.removeChannel(gameChannel);gameChannel=db.channel("rps-"+activeChat.id).on("postgres_changes",{event:"*",schema:"public",table:"chat_games",filter:"chat_id=eq."+activeChat.id},payload=>renderRps(payload.new?.state)).subscribe();});
document.querySelectorAll("[data-rps]").forEach(btn=>btn.addEventListener("click",async()=>{if(!activeChat)return;const {data,error}=await db.rpc("play_rps",{target_chat:activeChat.id,chosen_move:btn.dataset.rps});if(error){toast("Game failed to update. Run the latest SQL setup.");return;}renderRps(data);}));

$("mobile-back").addEventListener("click",()=>{$("app-screen").classList.remove("chat-open");});
function subscribeChatList(){
  if(listChannel)db.removeChannel(listChannel);
  listChannel=db.channel("my-chat-members-"+user.id).on("postgres_changes",{event:"*",schema:"public",table:"chat_members",filter:"user_id=eq."+user.id},async()=>{await loadChats();if(activeChat){const fresh=chats.find(c=>c.id===activeChat.id);if(fresh){activeChat=fresh;$("chat-title").textContent=fresh.title;}}}).subscribe();
}
start();
