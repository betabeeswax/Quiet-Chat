# QuietChat

A plain HTML/CSS/JavaScript private chat starter using your existing Supabase project. It is designed for static hosting on Vercel.

## Features
- Email + password accounts, Google sign-in, and guest accounts with a username
- One-time invite codes that expire after 24 hours
- Private 1-to-1 chats and group chats with realtime messages
- Persistent chat history saved in Supabase and loaded when you sign back in
- Send photos and videos (up to 50 MB)
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
- Never put a Supabase `service_role` key in browser code. This project uses only the publishable key.
- This is not end-to-end encrypted. Supabase project owners can access stored messages.
- Anonymous accounts are tied to browser storage; clearing browser data may make the account hard to recover.
- Invite codes should be shared privately. Anyone with a valid unused code can join.
- Jitsi calls use a public meeting service; the link is shared in the chat and is not a guarantee of confidential calls.
