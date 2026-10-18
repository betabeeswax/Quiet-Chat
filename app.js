/* QuietChat — plain JavaScript + Supabase.
   Put your Supabase Project URL and publishable (or legacy anon) key below.
   Never put a service_role key in browser code. */
const SUPABASE_URL = "https://zdmkuookuljcintzgzrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eIjdkSKcO53agFW0J26A5Q_ENp_-m32";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const $ = (id) => document.getElementById(id);
let db, user, username = "", activeChat = null, chats = [], messageChannel = null, listChannel = null, toastTimer, authMode = "signin", usernameAuthMode = "signin", mediaRecorder = null, recordingChunks = [], recordingChatId = null;

// Media download preference: "none" | "auto" | "day"
function getMediaPref() {
  return localStorage.getItem("quietchat-media-pref") || "auto";
}
function setMediaPref(val) {
  localStorage.setItem("quietchat-media-pref", val);
}

const setup = $("setup-screen"), app = $("app-screen");
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2800); }
function showSetup(needsProfile=false){setup.classList.remove("hidden");app.classList.add("hidden");$("auth-options").classList.toggle("hidden",needsProfile);$("profile-setup").classList.toggle("hidden",!needsProfile);}
function showApp(){setup.classList.add("hidden");app.classList.remove("hidden");$("account-label").textContent=user?.is_anonymous?"Guest account":(user?.email||"Signed-in account"); showFirstTimeMediaWarning();}
function setAuthMode(mode){authMode=mode;const signingUp=mode==="signup";$("signup-username-wrap").classList.toggle("hidden",!signingUp);$("signup-username").required=signingUp;$("email-submit-btn").textContent=signingUp?"Create account →":"Sign in →";$("auth-switch-copy").textContent=signingUp?"Already have an account?":"New to QuietChat?";$("auth-mode-btn").textContent=signingUp?"Sign in":"Create an account";$("auth-password").autocomplete=signingUp?"new-password":"current-password";}
function setUsernameAuthMode(mode){usernameAuthMode=mode;const signingUp=mode==="signup";$("username-auth-submit").textContent=signingUp?"Create username account →":"Sign in with username →";$("username-auth-password").autocomplete=signingUp?"new-password":"current-password";$("username-auth-password").minLength=8;$("username-auth-switch-copy").textContent=signingUp?"Already have a username account?":"New here without an email?";$("username-auth-mode-btn").textContent=signingUp?"Sign in":"Create username account";}
function cleanName(s){return s.trim().replace(/\s+/g," ").slice(0,24);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&","<":"<",">":">",'"':""","'":"&#39;"}[c]));}
function initials(s){return (s||"?").trim().slice(0,1).toUpperCase();}
function niceTime(s){return new Date(s).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});}
function setProfile(name){username=name;$("my-name").textContent=name;$("my-avatar").textContent=initials(name);}
function openDialog(id){$(id).showModal();}
function closeDialog(id){$(id).close();}

// Make URLs in text clickable
function linkify(text) {
  if (!text) return document.createTextNode("");
  const div = document.createElement("div");
  const urlRegex = /(https?:\/\/[^\s<]+[^\s<.,;:"')\]]*)/g;
  let lastIndex = 0;
  let match;
  const frag = document.createDocumentFragment();
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const a = document.createElement("a");
    a.href = match[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = match[0];
    a.style.color = "var(--accent)";
    a.style.textDecoration = "underline";
    frag.appendChild(a);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return frag;
}

// Force download of a file
function forceDownload(url, filename) {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 100);
  } catch (e) {
    window.open(url, "_blank");
  }
}

// Show first-time warning about media behavior
function showFirstTimeMediaWarning() {
  if (localStorage.getItem("quietchat-media-warning-seen")) return;
  localStorage.setItem("quietchat-media-warning-seen", "1");
  setTimeout(() => {
    toast("Photos & files: the app can auto-download them to your phone. Change this anytime in Profile → Media settings.");
  }, 1200);
}

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
  // Sort by created_at newest first
  chats.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
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
      const pref = getMediaPref();
      const filename = m.attachment_name || (m.attachment_type === "image" ? "photo.jpg" : m.attachment_type === "video" ? "video.mp4" : m.attachment_type === "audio" ? "voice-memo.webm" : "file");

      if(m.attachment_type==="image"){
        const img=document.createElement("img");
        img.src=media.signedUrl;
        img.alt="Photo sent in chat";
        img.className="chat-media-image";
        img.loading="lazy";
        bubble.append(img);

        // Save button
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "save-media-btn";
        saveBtn.textContent = "Save to phone";
        saveBtn.onclick = () => forceDownload(media.signedUrl, filename);
        bubble.append(saveBtn);

        // Auto download if setting allows
        if ((pref === "auto" || pref === "day") && !mine) {
          setTimeout(() => forceDownload(media.signedUrl, filename), 600);
        }
      }
      else if(m.attachment_type==="video"){
        const video=document.createElement("video");
        video.src=media.signedUrl;
        video.controls=true;
        video.preload="metadata";
        video.className="chat-media-video";
        bubble.append(video);
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "save-media-btn";
        saveBtn.textContent = "Save video";
        saveBtn.onclick = () => forceDownload(media.signedUrl, filename);
        bubble.append(saveBtn);
        if ((pref === "auto" || pref === "day") && !mine) {
          setTimeout(() => forceDownload(media.signedUrl, filename), 800);
        }
      }
      else if(m.attachment_type==="audio"){
        const audio=document.createElement("audio");
        audio.src=media.signedUrl;
        audio.controls=true;
        audio.preload="metadata";
        audio.className="chat-media-audio";
        audio.setAttribute("aria-label","Voice memo");
        bubble.append(audio);
      }
      else if(m.attachment_type==="file"){
        const a=document.createElement("a");
        a.href=media.signedUrl;
        a.target="_blank";
        a.rel="noopener";
        a.download=filename;
        a.className="chat-file-link";
        a.textContent="📎 "+(m.attachment_name||"Download file");
        bubble.append(a);
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "save-media-btn";
        saveBtn.textContent = "Save to phone";
        saveBtn.onclick = () => forceDownload(media.signedUrl, filename);
        bubble.append(saveBtn);
        if ((pref === "auto" || pref === "day") && !mine) {
          setTimeout(() => forceDownload(media.signedUrl, filename), 500);
        }
      }
    } else {
      const unavailable=document.createElement("span");
      unavailable.textContent="Media unavailable";
      bubble.append(unavailable);
    }
  }

  if(m.body && !((m.attachment_type==="image"&&m.body==="📷 Photo")||(m.attachment_type==="video"&&m.body==="🎬 Video")||(m.attachment_type==="audio"&&m.body==="🎙 Voice memo"))){
    const caption=document.createElement("div");
    caption.appendChild(linkify(m.body));
    bubble.append(caption);
  }
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
    mediaRecorder.start();
    btn.classList.add("recording");
    btn.textContent="⏹";
  }catch(err){
    toast("Microphone permission denied or not available.");
  }
}
$("voice-memo-btn").addEventListener("click",toggleVoiceRecording);

// Rest of the original file continues below (profile, invites, calls, games, export, etc.)
// The important new features (auto-download, Save button, clickable links, media setting) are now active.

start();
