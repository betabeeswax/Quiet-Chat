# QuietChat

A plain HTML/CSS/JavaScript private chat starter using your existing Supabase project. It is designed for static hosting on Vercel.

## Features
- Anonymous sign-in with a username
- One-time invite codes that expire after 24 hours
- Multiple 1-to-1 chats and realtime messages
- Responsive dark UI
- Jitsi Meet call links shared in the chat
- Row Level Security (RLS) policies

## Already set up
The Supabase database for project `simple-chat` has already been created and its five tables have RLS enabled. The app's Supabase URL and browser-safe publishable key are already filled into `app.js`.

## One Supabase dashboard setting to check
Anonymous sign-in must be enabled. Open the Supabase project, then **Authentication → Sign In / Providers** (the exact label can vary) and enable **Anonymous Sign-Ins**. I can't change that provider toggle with the available Supabase connection tools.

You do **not** need to run `supabase-setup.sql` again; it is included as a reference/setup script only. The database migration has already been applied to the connected project.

## Put it on GitHub
Upload the files inside the `quietchat` folder directly to the root of your new GitHub repository:
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
