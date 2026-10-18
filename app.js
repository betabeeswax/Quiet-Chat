/* QuietChat v2 — clean functional version
   Focus: working auth, invites, chats, realtime messages, one-time auto-download of media
*/
const SUPABASE_URL = "https://zdmkuookuljcintzgzrh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eIjdkSKcO53agFW0J26A5Q_ENp_-m32";
const configured = SUPABASE_URL.startsWith("https://");

const $ = (id) => document.getElementById(id);
let db, user, username = "", activeChat = null, chats = [], messageChannel = null, listChannel = null, toastTimer;
let authMode = "signin", usernameAuthMode = "signin";
let mediaRecorder = null, recordingChunks = [];

 // Track which messages we already auto-downloaded (so it only happens once)
const downloadedMedia = new Set(JSON.parse(localStorage.getItem("quietchat-downloaded") || "[]"));
function markDownloaded(id) {
  downloadedMedia.add(id);
  const arr = Array.from(downloadedMedia).slice(-200); // keep last 200
  localStorage.setItem("quietchat-downloaded", JSON.stringify(arr));
}

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function showSetup(needsProfile = false) {
  $("setup-screen").classList.remove("hidden");
  $("app-screen").classList.add("hidden");
  $("auth-options")?.classList.toggle("hidden", needsProfile);
  $("profile-setup")?.classList.toggle("hidden", !needsProfile);
}
function showApp() {
  $("setup-screen").classList.add("hidden");
  $("app-screen").classList.remove("hidden");
  $("account-label").textContent = user?.is_anonymous ? "Guest" : (user?.email || "Signed in");
}

function cleanName(s) { return (s || "").trim().replace(/\s+/g, " ").slice(0, 24); }
function initials(s) { return (s || "?").trim().slice(0, 1).toUpperCase(); }
function niceTime(s) { return new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

function linkify(text) {
  if (!text) return document.createTextNode("");
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:"')\]]*)/g;
  let last = 0, m;
  const frag = document.createDocumentFragment();
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement("a");
    a.href = m[0]; a.target = "_blank"; a.rel = "noopener"; a.textContent = m[0];
    a.style.color = "var(--accent)"; a.style.textDecoration = "underline";
    frag.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function forceDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url; a.download = filename || "file"; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 200);
}

async function start() {
  if (!configured) { $("config-warning")?.classList.remove("hidden"); return; }
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await db.auth.getSession();
  if (error) { toast(error.message); return; }
  if (data.session) { user = data.session.user; await loadProfile(); }
  else showSetup(false);
}

async function loadProfile() {
  const { data, error } = await db.from("profiles").select("username").eq("id", user.id).maybeSingle();
  if (error) { toast("Profile error"); showSetup(); return; }
  if (data?.username) {
    username = data.username;
    $("my-name").textContent = username;
    $("my-avatar").textContent = initials(username);
    showApp();
    await loadChats();
    subscribeList();
  } else {
    showSetup(true);
  }
}

// ===== AUTH =====
$("auth-mode-btn")?.addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  const up = authMode === "signup";
  $("signup-username-wrap")?.classList.toggle("hidden", !up);
  $("email-submit-btn").textContent = up ? "Create account →" : "Sign in →";
  $("auth-switch-copy").textContent = up ? "Already have an account?" : "New to QuietChat?";
  $("auth-mode-btn").textContent = up ? "Sign in" : "Create an account";
});

$("email-auth-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  $("email-submit-btn").disabled = true;
  try {
    if (authMode === "signup") {
      const name = cleanName($("signup-username").value);
      if (name.length < 2) { toast("Username too short"); return; }
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { username: name } } });
      if (error) { toast(error.message); return; }
      if (data.user) {
        user = data.user;
        await db.from("profiles").upsert({ id: user.id, username: name }, { onConflict: "id" });
        username = name; $("my-name").textContent = name; $("my-avatar").textContent = initials(name);
        showApp(); await loadChats(); subscribeList();
      } else toast("Check your email to confirm the account");
    } else {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) { toast(error.message); return; }
      user = data.user; await loadProfile();
    }
  } finally { $("email-submit-btn").disabled = false; }
});

$("username-auth-mode-btn")?.addEventListener("click", () => {
  usernameAuthMode = usernameAuthMode === "signin" ? "signup" : "signin";
  const up = usernameAuthMode === "signup";
  $("username-auth-submit").textContent = up ? "Create username account →" : "Sign in with username →";
  $("username-auth-switch-copy").textContent = up ? "Already have a username?" : "New without email?";
  $("username-auth-mode-btn").textContent = up ? "Sign in" : "Create username account";
});

$("username-auth-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("username-auth-name").value.trim().toLowerCase();
  const password = $("username-auth-password").value;
  if (!/^[a-z0-9_-]{2,24}$/.test(name)) { toast("Username: 2-24 letters/numbers/_/-"); return; }
  if (password.length < 8) { toast("Password min 8 characters"); return; }
  const btn = $("username-auth-submit"); btn.disabled = true;
  try {
    const fakeEmail = name + "@username.quietchat.invalid";
    if (usernameAuthMode === "signup") {
      const { data, error } = await db.functions.invoke("username-signup", { body: { username: name, password } });
      if (error || data?.error) { toast(data?.error || error?.message || "Signup failed"); return; }
    }
    const { data, error } = await db.auth.signInWithPassword({ email: fakeEmail, password });
    if (error) { toast("Login failed"); return; }
    user = data.user; await loadProfile();
  } finally { btn.disabled = false; }
});

$("guest-signin-btn")?.addEventListener("click", () => showSetup(true));
$("profile-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const name = cleanName($("username").value);
  if (name.length < 2) { toast("Username too short"); return; }
  if (!user) {
    const { data, error } = await db.auth.signInAnonymously();
    if (error) { toast("Enable Anonymous Sign-Ins in Supabase Auth"); return; }
    user = data.user;
  }
  const { error } = await db.from("profiles").upsert({ id: user.id, username: name }, { onConflict: "id" });
  if (error) { toast("Could not save username"); return; }
  username = name; $("my-name").textContent = name; $("my-avatar").textContent = initials(name);
  showApp(); await loadChats(); subscribeList();
});

// ===== CHATS =====
async function loadChats() {
  const { data, error } = await db.from("chat_members")
    .select("chat_id, chats(id, name, created_at, chat_members(user_id, profiles(username)))")
    .eq("user_id", user.id);
  if (error) { toast("Could not load chats"); return; }
  chats = (data || []).map(row => {
    const others = (row.chats?.chat_members || []).filter(m => m.user_id !== user.id);
    const title = row.chats?.name || others[0]?.profiles?.username || "Chat";
    return { id: row.chat_id, title, created_at: row.chats?.created_at, isGroup: !!row.chats?.name };
  });
  chats.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderChatList();
}

function renderChatList() {
  const list = $("chat-list");
  list.innerHTML = "";
  if (!chats.length) {
    list.innerHTML = '<div class="empty-small">No chats yet. Create or join one.</div>';
    return;
  }
  chats.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "chat-item" + (activeChat?.id === c.id ? " active" : "");
    btn.innerHTML = `<div class="avatar">${initials(c.title)}</div><div class="chat-item-text"><strong>${escapeHtml(c.title)}</strong><span class="preview">${c.isGroup ? "Group" : "Private"}</span></div>`;
    btn.onclick = () => openChat(c);
    list.appendChild(btn);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function openChat(chat) {
  activeChat = chat;
  $("app-screen").classList.add("chat-open");
  $("chat-title").textContent = chat.title;
  $("chat-subtitle").textContent = "Messages are live";
  $("chat-avatar").textContent = chat.isGroup ? "👥" : initials(chat.title);
  $("welcome-panel").classList.add("hidden");
  $("messages").classList.remove("hidden");
  $("composer-wrap").classList.remove("hidden");
  $("call-btn").disabled = false;
  renderChatList();

  if (messageChannel) db.removeChannel(messageChannel);
  messageChannel = db.channel("msg-" + chat.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` }, p => renderMessage(p.new, true))
    .subscribe();

  await loadMessages();
}

async function loadMessages() {
  const box = $("messages");
  box.innerHTML = "";
  const { data, error } = await db.from("messages")
    .select("id, chat_id, sender_id, body, created_at, attachment_path, attachment_type, attachment_name, profiles(username)")
    .eq("chat_id", activeChat.id)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) { toast("Could not load messages"); return; }
  (data || []).forEach(m => renderMessage(m, false)); // false = do not auto-download on history load
  box.scrollTop = box.scrollHeight;
}

async function renderMessage(m, isNew) {
  if (!activeChat || m.chat_id !== activeChat.id) return;
  if ($("messages").querySelector(`[data-id="${m.id}"]`)) return;

  const mine = m.sender_id === user.id;
  const wrap = document.createElement("article");
  wrap.className = "message" + (mine ? " mine" : "");
  wrap.dataset.id = m.id;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<span>${mine ? "You" : (m.profiles?.username || "Friend")}</span><span>${niceTime(m.created_at)}</span>`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (m.attachment_path) {
    const { data: signed } = await db.storage.from("chat-media").createSignedUrl(m.attachment_path, 3600);
    if (signed?.signedUrl) {
      const url = signed.signedUrl;
      const fname = m.attachment_name || "file";

      if (m.attachment_type === "image") {
        const img = document.createElement("img");
        img.src = url; img.className = "chat-media-image"; img.loading = "lazy";
        bubble.appendChild(img);
      } else if (m.attachment_type === "video") {
        const v = document.createElement("video");
        v.src = url; v.controls = true; v.className = "chat-media-video";
        bubble.appendChild(v);
      } else if (m.attachment_type === "audio") {
        const a = document.createElement("audio");
        a.src = url; a.controls = true; a.className = "chat-media-audio";
        bubble.appendChild(a);
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = fname; a.className = "chat-file-link";
        a.textContent = "📎 " + fname;
        bubble.appendChild(a);
      }

      // Save button always available
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "save-media-btn"; btn.textContent = "Save to phone";
      btn.onclick = () => forceDownload(url, fname);
      bubble.appendChild(btn);

      // Auto-download ONLY once when the message is new and not from me
      if (isNew && !mine && !downloadedMedia.has(m.id)) {
        markDownloaded(m.id);
        setTimeout(() => forceDownload(url, fname), 800);
      }
    } else {
      bubble.textContent = "Media unavailable";
    }
  }

  if (m.body && !(m.attachment_type === "image" && m.body === "📷 Photo") && !(m.attachment_type === "video" && m.body === "🎬 Video") && !(m.attachment_type === "audio" && m.body === "🎙 Voice memo")) {
    const div = document.createElement("div");
    div.appendChild(linkify(m.body));
    bubble.appendChild(div);
  }

  wrap.append(meta, bubble);
  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}

// Send text
$("message-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!activeChat) return;
  const input = $("message-input");
  const body = input.value.trim();
  if (!body) return;
  input.disabled = true;
  const { error } = await db.from("messages").insert({ chat_id: activeChat.id, sender_id: user.id, body });
  input.disabled = false;
  if (error) toast("Send failed");
  else { input.value = ""; input.style.height = "auto"; }
});
$("message-input")?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("message-form").requestSubmit(); }
});

// Attach file
$("media-input")?.addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file || !activeChat) return;
  if (file.size > 5 * 1024 * 1024) { toast("Max 5 MB"); return; }
  const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file";
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 8);
  const path = `${activeChat.id}/${user.id}/${crypto.randomUUID()}.${ext}`;
  toast("Uploading…");
  const { error: upErr } = await db.storage.from("chat-media").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) { toast("Upload failed"); return; }
  const body = type === "image" ? "📷 Photo" : type === "video" ? "🎬 Video" : type === "audio" ? "🎙 Voice memo" : "📎 " + file.name;
  await db.from("messages").insert({ chat_id: activeChat.id, sender_id: user.id, body, attachment_path: path, attachment_type: type, attachment_name: file.name });
  toast("Sent!");
  $("media-input").value = "";
});

// Voice memo (simple)
$("voice-memo-btn")?.addEventListener("click", async () => {
  if (!activeChat) { toast("Open a chat first"); return; }
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop(); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordingChunks = [];
    mediaRecorder.ondataavailable = e => recordingChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordingChunks, { type: "audio/webm" });
      const file = new File([blob], "voice.webm", { type: "audio/webm" });
      // reuse the media input flow
      const dt = new DataTransfer();
      dt.items.add(file);
      $("media-input").files = dt.files;
      $("media-input").dispatchEvent(new Event("change"));
      $("voice-memo-btn").textContent = "🎙";
      $("voice-memo-btn").classList.remove("recording");
    };
    mediaRecorder.start();
    $("voice-memo-btn").textContent = "⏹";
    $("voice-memo-btn").classList.add("recording");
  } catch { toast("Microphone permission needed"); }
});

// ===== INVITES =====
$("create-invite-btn")?.addEventListener("click", async () => {
  if (!user) return;
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const { error } = await db.from("invites").insert({ created_by: user.id, code, used: false });
  if (error) { toast("Could not create invite"); return; }
  $("invite-code").textContent = code;
  $("invite-dialog").showModal();
});
$("copy-code-btn")?.addEventListener("click", () => {
  navigator.clipboard.writeText($("invite-code").textContent).then(() => toast("Copied!"));
});
$("invite-done-btn")?.addEventListener("click", () => $("invite-dialog").close());
$("join-invite-btn")?.addEventListener("click", () => $("join-dialog").showModal());
$("join-form")?.addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("invite-input").value.trim().toUpperCase();
  if (!code) return;
  const { data: inv, error } = await db.from("invites").select("*").eq("code", code).eq("used", false).maybeSingle();
  if (error || !inv) { toast("Invalid or already used code"); return; }
  await db.from("invites").update({ used: true, used_by: user.id }).eq("id", inv.id);

  // Create chat and add both members
  const { data: chat, error: cErr } = await db.from("chats").insert({}).select().single();
  if (cErr) { toast("Could not create chat"); return; }
  await db.from("chat_members").insert([
    { chat_id: chat.id, user_id: inv.created_by },
    { chat_id: chat.id, user_id: user.id }
  ]);
  $("join-dialog").close();
  await loadChats();
  toast("Joined!");
});

$("welcome-create")?.addEventListener("click", () => $("create-invite-btn").click());
$("new-chat-btn")?.addEventListener("click", () => $("create-invite-btn").click());
$("mobile-back")?.addEventListener("click", () => $("app-screen").classList.remove("chat-open"));

// Call
$("call-btn")?.addEventListener("click", () => {
  if (!activeChat) return;
  const room = "QuietChat-" + activeChat.id.slice(0, 8);
  const url = "https://meet.jit.si/" + room;
  window.open(url, "_blank");
  db.from("messages").insert({ chat_id: activeChat.id, sender_id: user.id, body: "📞 Join call: " + url });
});

function subscribeList() {
  if (listChannel) db.removeChannel(listChannel);
  listChannel = db.channel("list-" + user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_members", filter: `user_id=eq.${user.id}` }, () => loadChats())
    .subscribe();
}

start();
