# Truth or Dare Rooms

## Build
- Replace the starter screen with a playable Truth or Dare experience where friends can create or join a room using a shareable invite link, choose nicknames, and take turns.
- Give each player a bot-selected Truth or Dare prompt; let the host advance turns and handle a skip/next choice.
- Add a separate private admin area for managing the Truth question and Dare prompt libraries. Admin controls stay locked until the user provides the allowed Gmail address.
- Keep game players account-free. Use Google sign-in only for the admin, restricted to the specified address.

## Technical details
- Enable Lovable Cloud for shared room state, prompt storage, and the admin's Google identity check.
- Enforce admin access on the server, not by hiding a link in the interface. Public room access uses room-scoped invite codes and nicknames, without exposing admin tools.
- Use the existing TanStack Start structure and semantic design tokens; add route-specific metadata for each content page.
