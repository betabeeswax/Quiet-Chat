# QuietChat — Complete Future Features Roadmap

**Status:** This document records the requested product specification. Items listed here are not automatically implemented merely by appearing in this roadmap. Test each feature before marking it complete or deploying it.

QuietChat is intended to be a customisable messaging website inspired by Discord and iMessage, with private chats, public communities, video/voice calls, and real-time multiplayer games. Keep the front end in plain HTML, CSS, and JavaScript; continue using Supabase for authentication, database data, storage, and real-time updates; deploy over HTTPS; and enforce permissions on the server/database, not only in the browser.

## 1. Messaging and friends
- Show the actual sender username in chat lists and notifications.
- Update messages automatically without refreshing; scroll to the newest message by default.
- Show dates and times; render links as clickable links.
- Support private one-to-one and group chats.
- Support photos, videos, voice messages, and files under 5 MB, subject to each chat/community's media rules.
- Allow users to edit/delete their own messages, reply, and react with emoji.
- Add a GIF picker, profile pictures, usernames, and bios.
- Provide online, away, and gaming statuses with privacy controls.

## 2. Public communities
- Let anyone discover, browse, search, and join public communities without an invite code.
- Let users create communities and manage members.
- Support multiple text channels; public/private channels and private communities.
- Support roles and moderators, reporting, blocking, kicking, and banning.
- Apply permissions on the server/database so users cannot bypass them by changing browser code.

## 3. Online multiplayer games
Planned games: chess, checkers, UNO-style cards, Connect 4, tic-tac-toe, rock-paper-scissors, Battleship, memory matching, Pong, Snake battles, two-player racing, and mini platform racing.
- Games must use shared, authoritative online state; separate local copies in different browsers do not count as multiplayer.
- Invite friends from chats; create private rooms or join public lobbies; support community members.
- Synchronise moves and scores live without refreshing and recover/reconnect after disconnects.
- Support same-device local multiplayer where suitable and keep the Games tab easy to access.

## 4. Video and voice calls
- Let users choose in-page calls or a separate browser tab.
- Prefer a guest-friendly provider that does not require every participant to create an account.
- Send call invitations in chats; support camera, microphone, screen sharing, and group calls where possible.
- Provide an alternative external link if embedded calling fails.
- Use HTTPS and explain browser/provider permission limitations clearly.

## 5. Notifications
- Show the real sender username, message preview, and chat/community name.
- Provide Yes/No controls in Settings; optional sounds and message previews.
- Respect browser notification permissions and privacy settings.
- Example: “Alex — Hey, want to play chess? · Gaming Chat — now”.

## 6. Website customisation
- Preset accent colours: blue, purple, green, red, pink, and orange, plus a custom colour picker.
- Dark, light, and extra-dark themes.
- Custom backgrounds and chat wallpapers.
- Adjustable text size, message bubbles, and sidebar layout.
- Save preferences automatically.

## 7. Media library and storage
- Add a Local Media Library in the sidebar for shared photos, videos, and voice messages.
- Filter media by person, chat, date, and type.
- Support file downloads and conversation exports, including chat text and available media in PDF/export formats.
- Saving modes: manual, automatic, or one-day saving.
- Show a clear privacy/storage warning during signup.
- Explain browser local-storage limits and cloud-vs-local behaviour; do not imply a website can silently save to any arbitrary local-drive folder.

## 8. Settings page
Create clear sections:
- **Appearance:** themes, colours, backgrounds, layout.
- **Notifications:** on/off, previews, sounds.
- **Calls:** provider and in-page/new-tab choice.
- **Account & Privacy:** profile, sign-in, blocking, security.
- **Storage & Media:** local library and saving preferences.
- **Chats & Export:** PDF, downloads, search, message expiration.
- **Games & Communities:** activity privacy and community preferences.

## 9. Unique features
- Private message bookmarks.
- Advanced search for messages, links, files, and photos by person/date.
- Configurable message retention, including yearly cleanup of messages older than one year.
- Friend activity with controls to hide online/game status.
- Privacy dashboard for blocked users, sessions, media storage, and exports.
- Invite an entire group chat or community into a game session.

## 10. Group inactivity and media rules (required)
### Automatic removal
- Apply to every group, including private group chats and public communities.
- After **30 days without sending a message in that group**, remove an inactive member.
- Send a warning **7 days before removal** (that is, at 23 days of inactivity).
- A message sent by that member in the group resets the inactivity timer and cancels the pending warning/removal.
- Implement the timer and enforcement securely on the server (for example, a scheduled Supabase job/function); do not depend on a member keeping the website open.
- Notify the person why they were removed. Removed members must not be able to post until they rejoin.
### Rejoining
- Show removed members a **Rejoin group** option when the group's privacy/access rules allow it.
- When they rejoin, post a welcome-back system message in the group.
- Preserve old messages where allowed by group privacy and retention rules; do not restore access to private content if access policy says otherwise.
### GIFs and pictures
| Conversation type | GIFs | Pictures |
|---|---|---|
| Public groups/communities | Allowed | **Not allowed** |
| Private groups | Disabled | Follow existing private-group rules |
| One-to-one chats | Disabled | Follow existing one-to-one chat rules |
- Enforce these restrictions in the upload/message endpoint and database/storage access rules as well as the interface. A client-side hide/disable alone is not sufficient.
- Keep the existing file-size limit and other media rules for other file types unless explicitly changed.

## 11. Recommended development order
1. **Reliability:** correct usernames, live messaging, auto-scroll, notifications, dependable calls.
2. **Customisation:** Settings redesign, colour presets, themes, profiles.
3. **Communities:** public discovery, channels, membership, roles, moderation, inactivity rules, media restrictions.
4. **Online games:** playable shared-state games, lobbies, invites, reconnect handling.
5. **Advanced features:** media library, bookmarks, search, exports, and retention controls.

## Acceptance and safety notes
- Treat this as a roadmap, not proof of implementation.
- Test with at least two separate accounts/browsers, including denied access, removed members, rejoining, and real-time updates.
- Validate uploads and membership on the server/database; never trust client-only checks.
- Check migrations and backup data before changing the Supabase schema or running cleanup jobs.
- Do not delete messages/media automatically until the retention rules and user-facing warnings are clear and tested.
