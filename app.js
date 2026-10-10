/* QuietChat — plain JavaScript + Supabase.
   Put your Supabase Project URL and publishable (or legacy anon) key below.
   Never put a service_role key in browser code. */
const SUPABASE_URL = "https://zdmkuookuljcintzgzrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eIjdkSKcO53agFW0J26A5Q_ENp_-m32";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const $ = (id) => document.getElementById(id);
let db, user, username = "", activeChat = null, chats = [], messageChannel = null, listChannel = null, toastTimer;

const setup = $("setup-screen"), app = $("app-screen");
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2800); }
function showSetup(){setup.classList.remove("hidden");app.classList.add("hidden");}
function showApp(){setup.classList.add("hidden");app.classList.remove("hidden");}
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
  if(data.session){user=data.session.user;await loadProfile();} else showSetup();
}
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("username").eq("id",user.id).maybeSingle();
  if(error){toast("Could not load your profile. Check the SQL setup.");showSetup();return;}
  if(data?.username){setProfile(data.username);showApp();await loadChats();subscribeChatList();}
  else {showSetup();$("username").focus();}
}
$("profile-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!configured)return;
  const name=cleanName($("username").value);if(name.length<2){toast("Use at least 2 characters.");return;}
  const {data,error}=await db.auth.signInAnonymously();
  if(error){toast("Anonymous sign-in failed. Enable it in Supabase Auth.");return;}
  user=data.user;
  const {error:saveError}=await db.from("profiles").upsert({id:user.id,username:name},{onConflict:"id"});
  if(saveError){toast("Could not save username: "+saveError.message);return;}
  setProfile(name);showApp();await loadChats();subscribeChatList();
});
async function loadChats(){
  const {data,error}=await db.from("chat_members").select("chat_id,chats(id,created_at,chat_members(user_id,profiles(username)))").eq("user_id",user.id);
  if(error){toast("Couldn't load chats. Check the database SQL.");return;}
  chats=(data||[]).map(row=>{
    const members=(row.chats?.chat_members||[]).filter(m=>m.user_id!==user.id);
    const other=members[0]?.profiles?.username || "Waiting for friend";
    return {id:row.chat_id,created_at:row.chats?.created_at,title:other,memberCount:row.chats?.chat_members?.length||1};
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
    const preview=document.createElement("span");preview.className="preview";preview.textContent=chat.memberCount<2?"Invite sent · waiting to join":"Private conversation";
    t.append(strong,preview);b.append(av,t);b.addEventListener("click",()=>selectChat(chat));list.append(b);
  });
}
async function selectChat(chat){
  activeChat=chat;$("app-screen").classList.add("chat-open");$("chat-title").textContent=chat.title;$("chat-subtitle").textContent="Private chat · messages are live";$("chat-avatar").textContent=initials(chat.title);
  $("welcome-panel").classList.add("hidden");$("messages").classList.remove("hidden");$("composer-wrap").classList.remove("hidden");$("call-btn").disabled=false;renderChats();
  if(messageChannel){db.removeChannel(messageChannel);messageChannel=null;}
  await loadMessages();
  messageChannel=db.channel("messages-"+chat.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"chat_id=eq."+chat.id},payload=>renderMessage(payload.new)).subscribe();
}
async function loadMessages(){
  const area=$("messages");area.replaceChildren();
  const {data,error}=await db.from("messages").select("id,chat_id,sender_id,body,created_at,profiles(username)").eq("chat_id",activeChat.id).order("created_at",{ascending:true}).limit(500);
  if(error){toast("Couldn't load messages.");return;}
  (data||[]).forEach(renderMessage);area.scrollTop=area.scrollHeight;
}
function renderMessage(m){
  if(!activeChat||m.chat_id!==activeChat.id)return;
  if($("messages").querySelector(`[data-message-id="${CSS.escape(m.id)}"]`))return;
  const mine=m.sender_id===user.id, wrap=document.createElement("article");wrap.className="message"+(mine?" mine":"");wrap.dataset.messageId=m.id;
  const meta=document.createElement("div");meta.className="message-meta";const who=document.createElement("span");who.textContent=mine?"You":(m.profiles?.username||"Friend");const time=document.createElement("span");time.textContent=niceTime(m.created_at);meta.append(who,time);
  const bubble=document.createElement("div");bubble.className="bubble";bubble.textContent=m.body;wrap.append(meta,bubble);$("messages").append(wrap);$("messages").scrollTop=$("messages").scrollHeight;
}
$("message-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!activeChat)return;const input=$("message-input"),body=input.value.trim();if(!body)return;
  input.disabled=true;
  const {error}=await db.from("messages").insert({chat_id:activeChat.id,sender_id:user.id,body});
  input.disabled=false;if(error){toast("Message didn't send. Check your connection.");return;}input.value="";input.style.height="auto";input.focus();
});
$("message-input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("message-form").requestSubmit();}});
$("message-input").addEventListener("input",e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,140)+"px";});
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
