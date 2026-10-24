# QuietChat community UI update plan

This file records the community features requested for the next implementation pass. It is documentation only; it does not claim these features are already implemented.

## Sidebar and navigation
- Add a Communities entry beside Create group chat.
- Keep the sidebar fixed while the chat pane scrolls.
- Add an Online Games entry.

## Communities
- Let people browse and join public communities without an invite.
- Let members create communities and manage community settings.
- Provide a community setting for an always-public community.
- Support public/private groups.
- Add group settings and member management.
- Inactive-member policy requested: warn 7 days before removal after 30 days without a message; cancel the warning and reset the timer when the member posts; allow removed members to rejoin and post a welcome-back message.

## Composer
- Move emoji, GIF, and voice-to-text controls into the + attachment menu.
- GIFs should be available only in public groups; disable GIFs in private groups and one-to-one chats.
- Do not allow pictures in public groups. Keep other media limits consistent with the app's existing policy.

## Important implementation note
Real public communities and synced multiplayer games require database schema, row-level security policies, and server-side/realtime logic. A visual-only control is not a working feature. Implement and test the backend and UI together before describing these features as available.
