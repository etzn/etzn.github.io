# Avalon (party edition)

A no-ads, no-accounts web version of *The Resistance: Avalon* for one table of friends at a time.
It's a static site, so GitHub Pages hosts it for free. One browser tab acts as the game server, and
every phone connects to that tab directly over WebRTC.

- **Players:** `https://etzn.github.io/avalon/`
- **Host:** `https://etzn.github.io/avalon/admin/`

## Deploy

1. Create a new GitHub repo and push the contents of this folder to `main`:
   ```sh
   git init && git add . && git commit -m "Avalon"
   git branch -M main
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`**.
3. Wait a minute, then open `https://etzn.github.io/avalon/admin/`.

There's no build step. It's plain HTML, CSS and ES modules.

## Running a game

1. The host opens `/admin/` on their phone (or a laptop or TV). That tab **is** the game, so keep it open and
   in the foreground. The page asks the browser to keep the screen awake.
2. Everyone else scans the QR code, or opens the link and types the 5-letter room code.
3. In the admin page, choose roles and rules, arrange the seat order to match the table (it sets leader
   rotation), then tap **Deal roles & start**.
4. Play. The app handles what physical cards do badly: the secret deal and night info, secret votes,
   anonymous mission cards, Lady of the Lake, and the assassination. You do the talking.

**Host plays too (the default).** The host's own screen shows only their own seat, just like everyone else's.
Untick *I'm playing on this device* to turn it into a non-playing host or public board instead.

**Shared screen.** The admin page has a "public board" link: open it on a TV or laptop to show the
missions, the vote track and results with no secret information.

**Refreshes and dropouts are fine.** The host saves the game after every move. If a player's phone
sleeps or reloads, it reconnects to the same seat on its own. If the host reloads, players reconnect on their
own too. After a host refresh the room code can take up to a minute to free up on the matchmaking server.

## Rules implemented

- The official 5–10 player table: team sizes, evil counts, and mission 4 needing two fails at 7+.
- Roles: Merlin, Percival, Loyal Servants, Assassin, Morgana, Mordred, Oberon and Minions, with correct
  visibility. (Merlin doesn't see Mordred. Percival sees Merlin and Morgana unlabeled. Evil doesn't see
  Oberon, and Oberon sees nobody.)
- Team votes need a strict majority (ties reject). Five rejected proposals in a row means evil wins. Good
  players can only play Success. Only the *count* of fail cards is kept, never who played them.
- Lady of the Lake after missions 2, 3 and 4, starting with the player to the first leader's right. A player who
  has held it can't be examined.
- Assassination after three successes, if both Merlin and the Assassin are in play.
- Optional **out-loud voting**: everyone votes with thumbs and the leader taps the result.
- Optional **overrides** for evil count and mission sizes, for player counts outside 5–10 or house rules.
  For 2–4 or 11+ players the app uses an improvised table and labels it as unofficial.

## How it works / caveats

- Connections use [PeerJS](https://peerjs.com/). Its free public server only matchmakes; game traffic
  goes device to device. When devices can't reach each other directly (some strict corporate or university
  networks, some mobile carriers), PeerJS falls back to its public TURN relay. If that's flaky, you can run
  your own `peerjs-server` and point the app at it under **Admin → Advanced**. The join link carries that
  setting to the players.
- The host device has the full game state, so this is an honor-system app. Nothing on screen reveals
  other players' roles, but a determined host with dev tools could look.
- Mobile browsers freeze background tabs. If the host switches apps for long, players see
  "reconnecting" until the host returns. No state is lost.

## Files

```
index.html        player page
admin/index.html  host page
js/game.js        rules engine (pure, no DOM)
js/ui.js          player view, shared by players and the host's own seat
js/host.js        host: networking, persistence, admin controls
js/player.js      player: join form, connection and reconnection
js/net.js         PeerJS helpers, room codes, wake lock
css/style.css
test/game.test.mjs   npm test (Node 18+)
```
