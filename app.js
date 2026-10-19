/* QuietChat — plain JavaScript + Supabase.
   Put your Supabase Project URL and publishable (or legacy anon) key below.
   Never put a service_role key in browser code. */
const SUPABASE_URL = "https://zdmkuookuljcintzgzrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eIjdkSKcO53agFW0J26A5Q_ENp_-m32";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const $ = (id) => document.getElementById(id);
let db, user, username = "", activeChat = null, chats = [], messageChannel = null, listChannel = null, toastTimer, authMode = "signin", mediaRecorder = null, recordingChunks = [], recordingChatId = null;

const setup = $("setup-screen"), app = $("app-screen");
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2800); }
function showSetup(needsProfile=false){setup.classList.remove("hidden");app.classList.add("hidden");$("auth-options").classList.toggle("hidden",needsProfile);$("profile-setup").classList.toggle("hidden",!needsProfile);}
function showApp(){setup.classList.add("hidden");app.classList.remove("hidden");$("account-label").textContent=user?.is_anonymous?"Guest account":(user?.email||"Signed-in account");}
function setAuthMode(mode){authMode=mode;const signingUp=mode==="signup";$("signup-username-wrap").classList.toggle("hidden",!signingUp);$("signup-username").required=signingUp;$("email-submit-btn").textContent=signingUp?"Create account →":"Sign in →";$("auth-switch-copy").textContent=signingUp?"Already have an account?":"New to QuietChat?";$("auth-mode-btn").textContent=signingUp?"Sign in":"Create an account";$("auth-password").autocomplete=signingUp?"new-password":"current-password";}
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
  setAuthMode("signin");
}
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("username").eq("id",user.id).maybeSingle();
  if(error){toast("Could not load your profile. Check the SQL setup.");showSetup();return;}
  if(data?.username){setProfile(data.username);showApp();await loadChats();subscribeChatList();}
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
      if(data.session&&data.user){user=data.user;const {error:saveError}=await db.from("profiles").upsert({id:user.id,username:name},{onConflict:"id"});if(saveError){toast("Account made, but username save failed: "+saveError.message);return;}setProfile(name);showApp();await loadChats();subscribeChatList();}
      else toast("Account created! Check your email to confirm it, then sign in.");
    }else{
      const {data,error}=await db.auth.signInWithPassword({email,password});
      if(error){toast(error.message);return;}
      user=data.user;await loadProfile();
    }
  }finally{$("email-submit-btn").disabled=false;}
});
$("guest-signin-btn").addEventListener("click",()=>{showSetup(true);$("username").focus();});
$("profile-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!configured)return;
  const name=cleanName($("username").value);if(name.length<2){toast("Use at least 2 characters.");return;}
  if(!user){const {data,error}=await db.auth.signInAnonymously();if(error){toast("Guest sign-in failed. Enable Anonymous Sign-Ins in Supabase Auth.");return;}user=data.user;}
  const {error:saveError}=await db.from("profiles").upsert({id:user.id,username:name},{onConflict:"id"});
  if(saveError){toast("Could not save username: "+saveError.message);return;}
  setProfile(name);showApp();await loadChats();subscribeChatList();
});
async function loadChats(){
  const {data,error}=await db.from("chat_members").select("chat_id,chats(id,name,created_at,chat_members(user_id,profiles(username)))").eq("user_id",user.id);
  if(error){toast("Couldn't load chats. Check the database SQL.");return;}
  chats=(data||[]).map(row=>{
    const members=(row.chats?.chat_members||[]).filter(m=>m.user_id!==user.id);
    const memberCount=row.chats?.chat_members?.length||1;
    const other=members[0]?.profiles?.username || "Waiting for friend";
    return {id:row.chat_id,created_at:row.chats?.created_at,title:row.chats?.name || other,memberCount,isGroup:Boolean(row.chats?.name)};
  });
  renderChats();
}
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
  });
}
async function selectChat(chat){
  activeChat=chat;$("app-screen").classList.add("chat-open");$("chat-title").textContent=chat.title;$("chat-subtitle").textContent=chat.isGroup?`${chat.memberCount} members · Messages are live`:"Private chat · messages are live";$("chat-avatar").textContent=chat.isGroup?"👥":initials(chat.title);
  $("welcome-panel").classList.add("hidden");$("messages").classList.remove("hidden");$("composer-wrap").classList.remove("hidden");$("call-btn").disabled=false;$("add-people-btn").classList.toggle("hidden",!chat.isGroup);$("add-people-btn").disabled=false;renderChats();
  if(messageChannel){db.removeChannel(messageChannel);messageChannel=null;}
  // Subscribe before fetching history so a message sent during loading is not missed.
  messageChannel=db.channel("messages-"+chat.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"chat_id=eq."+chat.id},payload=>renderMessage(payload.new)).subscribe();
  await loadMessages();
}
async function loadMessages(){
  const area=$("messages");area.replaceChildren();
  const {data,error}=await db.from("messages").select("id,chat_id,sender_id,body,created_at,attachment_path,attachment_type,profiles(username)").eq("chat_id",activeChat.id).order("created_at",{ascending:true}).limit(500);
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
      else if(m.attachment_type==="audio"){const audio=document.createElement("audio");audio.src=media.signedUrl;audio.controls=true;audio.preload="metadata";audio.className="chat-media-audio";audio.setAttribute("aria-label","Voice memo");bubble.append(audio);}
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
  const type=forcedType || (file.type.startsWith("image/")?"image":file.type.startsWith("video/")?"video":file.type.startsWith("audio/")?"audio":null);
  const allowed=type==="image"||type==="video"||type==="audio";
  if(!allowed){toast("Choose a supported photo or video, or record a voice memo.");$("media-input").value="";return;}
  if(file.size>50*1024*1024){toast("That file is too big. The limit is 50 MB.");$("media-input").value="";return;}
  let ext=(file.name?.split(".").pop()||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8);
  if(!ext || ext===file.name?.toLowerCase()) ext=type==="audio"?(file.type.includes("mp4")?"m4a":file.type.includes("ogg")?"ogg":"webm"):type==="video"?"mp4":"jpg";
  const chatId=activeChat.id;
  const path=`${chatId}/${user.id}/${crypto.randomUUID()}.${ext}`;
  toast(type==="audio"?"Sending voice memo…":"Uploading media…");
  const {error:uploadError}=await db.storage.from("chat-media").upload(path,file,{contentType:(file.type|| (type==="audio"?"audio/webm":"application/octet-stream")).split(";")[0],upsert:false});
  if(uploadError){toast("Upload failed. Check your connection and media storage setup.");$("media-input").value="";return;}
  const body=type==="image"?"📷 Photo":type==="video"?"🎬 Video":"🎙 Voice memo";
  const {error}=await db.from("messages").insert({chat_id:chatId,sender_id:user.id,body,attachment_path:path,attachment_type:type});
  if(error){await db.storage.from("chat-media").remove([path]);toast("Uploaded, but the message failed to save. Please try again.");}
  else toast(type==="audio"?"Voice memo sent!":type==="image"?"Photo sent!":"Video sent!");
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
$("mobile-back").addEventListener("click",()=>{$("app-screen").classList.remove("chat-open");});
function subscribeChatList(){
  if(listChannel)db.removeChannel(listChannel);
  listChannel=db.channel("my-chat-members-"+user.id).on("postgres_changes",{event:"*",schema:"public",table:"chat_members",filter:"user_id=eq."+user.id},async()=>{await loadChats();if(activeChat){const fresh=chats.find(c=>c.id===activeChat.id);if(fresh){activeChat=fresh;$("chat-title").textContent=fresh.title;}}}).subscribe();
}
start();
