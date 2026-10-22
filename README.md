# QuietChat

A plain HTML/CSS/JavaScript private chat starter using your existing Supabase project. It is designed for static hosting on Vercel.

## Features
- Email + password accounts, username + password accounts without an email, Google sign-in, and guest accounts
- One-time invite codes that expire after 24 hours
- Private 1-to-1 chats and group chats with realtime messages
- Persistent chat history saved in Supabase and loaded when you sign back in
- Send any file type up to 5 MiB
- Record and send voice memos from the microphone (browser permission required)
- Responsive dark UI
- Jitsi Meet call links shared in the chat
- Row Level Security (RLS) policies

## Already set up
The Supabase database for project `simple-chat` has already been created and its five tables have RLS enabled. The app's Supabase URL and browser-safe publishable key are already filled into `app.js`.

## Supabase sign-in setup (required)
In your Supabase dashboard, open **Authentication → Sign In / Providers** (labels may vary):
- Enable **Email** for email/password accounts.
- Enable **Google** and add the Google OAuth Client ID and Client Secret from Google Cloud. Follow Supabase's Google provider instructions; the Google button will not work until credentials are configured.
- Enable **Anonymous Sign-Ins** if you want the guest option to work.

Then open **Authentication → URL Configuration** and add your deployed Vercel URL to the allowed redirect URLs (and your local URL if testing locally). The app redirects Google sign-in back to the current site. If email confirmation is enabled, users must confirm their email before signing in.

Username + password sign-up is handled by the deployed Supabase Edge Function `username-signup`. It creates a Supabase Auth user with an internal `.invalid` address (not a real email) and confirms it server-side. The service-role key stays on the server and must never be copied into the website. Username accounts require passwords of at least 8 characters and have no email-based password reset.

More providers (such as Apple or Discord) can be added later by enabling/configuring them in Supabase and adding a button in the app.

The connected Supabase project has been updated for group chats, photo/video attachments, and voice memos. Chat history and message records are stored in Supabase; uploaded media is stored in a private Storage bucket. The website code still needs to be uploaded to GitHub and deployed to Vercel before you can test these changes live.

## Put it on GitHub
Upload/replace the files inside the `quietchat` folder directly in the root of your GitHub repository:
- `index.html`
- `style.css`
- `app.js`
- `supabase-setup.sql`
- `README.md`

Then send me the repository URL. I'll connect it to Vercel and check the deployment.

## Privacy and limitations
- Never put a Supabase `service_role` key in browser code. This project uses only the publishable key in `app.js`; the deployed `username-signup` Edge Function uses the server-side key from Supabase environment variables.
- This is not end-to-end encrypted. Supabase project owners can access stored messages.
- Guest accounts are tied to browser storage; clearing browser data may make a guest account hard to recover. Username/password accounts can sign in on another device with the same username and password, but there is no email-based password reset.
- Invite codes should be shared privately. Anyone with a valid unused code can join.
- Jitsi calls use a public meeting service; the link is shared in the chat and is not a guarantee of confidential calls.


## Latest features (October 2026)
- Three account options: email + password, username + password without an email, and anonymous guest mode. Username login uses the deployed `username-signup` Supabase Edge Function and a private username registry. Username/password accounts cannot receive password-reset emails, so keep the password safe.
- Optional profile bio and private profile picture.
- Any attachment type up to 5 MiB, including photos, videos, audio, and documents.
- Export chats through a print-friendly transcript; use the browser's Print → Save as PDF. Attachment URLs are included as temporary links, not embedded media.
- Multiplayer rock-paper-scissors in a chat.
- `privacy.html` privacy policy.
- Yearly retention job scheduled for January 1: messages older than one year and chats older than one year are removed. Confirm that Supabase Cron has the `quietchat-annual-cleanup` job after running the SQL.

## Updating your database
Open Supabase Dashboard → SQL Editor, paste and run the complete `supabase-setup.sql` file. It is designed to be re-runnable. Check Supabase Database → Cron for `quietchat-annual-cleanup`. If the job was not created, enable `pg_cron` or schedule `select public.quietchat_annual_cleanup();` for 03:00 on January 1.

## PDF export note
The export opens a new browser tab. Click **Print / Save as PDF** and choose **Save as PDF**. Call links remain in the transcript. Private attachment links expire and are not embedded into the PDF.


## Calls, games, emoji and file sizes

- The call button opens a video call embedded inside QuietChat using Jitsi Meet. FaceTime itself cannot be embedded into a third-party website; Jitsi is the in-app alternative.
- The chat header stays pinned at the top while you scroll.
- Emoji picker is built in; GIF search opens Tenor in a new tab so you can copy a GIF URL into chat.
- Chat uploads are configured for up to 50 MiB per file, subject to the Supabase project-wide upload limit. Supabase Free projects have a maximum global file-size limit of 50 MB; the Pro plan can raise this much higher.
- Games include simplified UNO, Tic-tac-toe, Connect Four, Checkers, Chess (free-move practice mode), Battleship, Memory Match, Hangman, and online Rock Paper Scissors. Except for Rock Paper Scissors, the included games are pass-and-play on one device and are not synchronized multiplayer yet.


## Latest local-media and notification updates
- **Local media library:** when a chat attachment is viewed, QuietChat attempts to keep a copy in this browser's IndexedDB. Use **Local media library** to browse cached photos/videos/files by newest date and download copies to your computer. This is browser storage, not a normal Windows folder; browser cleanup can erase it, and each device has its own library.
- **Clickable links:** URLs in message text are rendered as links and open in a new tab.
- **Date sorting:** message history is requested oldest-to-newest and is grouped by local calendar date; hovering/tapping a message time can show the full timestamp.
- **Notifications:** choose **Enable notifications**. This browser notification works when the site is open and the tab is hidden. Reliable notifications when the browser is fully closed require push notifications and a service worker/backend, which are not included here.
- **First-use warning:** the first visit in a browser shows a warning about cloud storage, local copies, and calls.
- **Calls:** the Jitsi call remains embedded in the website. Jitsi rooms are not authenticated private rooms just because the room name is hard to guess; don't treat this as end-to-end private.

**Important storage limitation:** this version keeps local copies but still uploads shared chat attachments to Supabase, because that is how the other participant can receive them. It does not delete the cloud originals. A website cannot silently write files to an arbitrary local-drive folder, and deleting the cloud originals before every recipient has a local copy could make those attachments unavailable. To make attachments truly local-only, the app would need to stop sharing them across devices/users or be redesigned around a local desktop app.


## October 2026 fixes
- Fixed the startup JavaScript error caused by a listener being attached to a missing `export-btn` element.
- Added automatic scroll-to-latest behaviour after message rendering.
- Call invitations now include a QuietChat deep link (`?call=CHAT_ID`) that opens the same chat and starts the same Jitsi room after the invited person signs in. The recipient must already be a member of that chat.
- Added an “Open Jitsi in new tab” fallback for browsers that cannot run the embedded call, and a way to share an existing Google Meet, Zoom, or Microsoft Teams meeting URL.
- Added an all-chats export action inside Settings and a persistent notification on/off toggle.
- Links in messages remain clickable.

Note: These changes were checked for JavaScript syntax, but live calls, authentication, Supabase permissions, and multiplayer sessions still need to be tested on the deployed site with two accounts. External meeting services such as Google Meet generally cannot be embedded directly inside another website, so those links open in a separate tab.
