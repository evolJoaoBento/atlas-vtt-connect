# Atlas VTT Extension - Connect

Play [Atlas VTT](https://github.com/ByteMirror/atlas-vtt) maps online with your group. You host from Obsidian; players join from a web page or from their own Obsidian. No accounts, no server to run.

Connect is an independent plugin, not made by or affiliated with the Atlas VTT author. It changes nothing in Atlas.

## Install

1. Obsidian 1.8.7 or newer, on desktop.
2. Settings → Community plugins → Browse: install and enable **Atlas VTT**, then **Atlas VTT Extension - Connect**.

**Updating to 0.2.0:** the GM and every player in Obsidian should update together (Settings → Community plugins → Check for updates). The web join page updates by itself. An older Connect drops all templates once someone places a square.

## For the GM

### Start a session

1. Open a map in Atlas.
2. Click the **Online session** button Connect adds to Atlas's toolbar (or run **Online session** from the command palette), then **Start online session**.
3. Copy the join link and send it to your players.
4. When a player asks to join, a notice says so: click **Allow** or **Deny**. The same requests show in the session panel.

The panel lists who is connected. **Remove player** (×) sends someone out; they must be allowed again. **Stop online session** ends it for everyone.

### What players see

Players see the scene you present, with what Atlas's own player window would show: hidden tokens, fog and line of sight stay hidden. It is drawn as that window draws it, following your map's settings: token rings and their ring size, numbered badges on look-alike tokens, the grid's colour and line style, pin icons, downed tokens greyed under a skull, and a fade when you present another scene.

- **Present a scene:** present it in Atlas as usual (the eye on its scene tab).
- **Dynamic lighting:** turn on Atlas's dynamic lighting experiment and players see only what their tokens see, plus the places they explored before.
- **Health bars:** the resources a collection marks **visible to players** (its settings, Resources) show as bars on tokens, as in Atlas's player window. Resources in the other slots (2 to 5) show as small wheels beside the token.
- **Per token:** right-click a character token → **Edit Token**. Under **Players see**, each resource the token has gets two dropdowns: **Bar and numbers**, **Bar only**, **Number only** or **Hidden**. They apply when you click **Save**.
  - **This token:** applies to that token only.
  - **Every *Goblin*:** applies to every token with that statblock, on every map.
  - The token's own choice wins over its statblock's, and the statblock's over the map default (the collection's setting). **Same as every *Goblin*** and **Map default** undo a choice.
  - A choice can also show a resource the collection hides, so you can hide HP for the whole collection and show it only on the tokens you pick.
  - **Bar only:** players see how full it is, never the numbers. **Number only:** players see the current value alone (19, never 19 / 27). **Hidden:** the bar also disappears from the initiative column.
  - Choices are saved with your vault and kept between sessions, so you can set them while preparing.
  - A downed token is still greyed with a skull. A player's own sheet still shows its exact numbers.
- **Whose turn:** with the initiative list shown to players, they see the order as a column at the right of their map, the token whose turn it is gets a white ring, and its player reads "Your turn".
- **Readable pins:** a note pin you mark readable (right-click the pin) shows on players' maps with the note's title, where they can see that spot.

### Let players move tokens

Right-click a token on the map → **Controlled by** → tick the players. They can now drag it. Moves snap to your grid, stop at walls on a lit scene, and are refused while you are dragging.

**Sheets:** a player sees the stat block of every token they control, with its exact numbers (HP 19 / 27), and can roll its abilities, saves, skills and attacks from it; the roll is made by your Atlas and logged under their name. Mind that this includes a monster or NPC you hand to a player.

**Player characters:** mark a token as a player character in Atlas (right-click → player character), then give it to a player with **Controlled by**. Connect remembers that player by name and gives them that character on every scene and in later sessions. Untick them to take it back.

### Dice and lasers

- Players' rolls are rolled by Atlas's own dice, by the map's rules, thrown on your screen and logged under their name. Your rolls reach their dice log.
- Your laser pointer shows on players' maps, and theirs on yours.
- Players' pings and lasting templates show on your map too. Each template has a small **×** on its edge: click it to erase that template for everyone. **Clear players' templates** (command palette) takes them all away.

### Show an image

Run **Show image to players…**, pick an image from your vault, and every player sees it over their map (they can close it and open it again). **Stop showing image to players** takes it away.

### Split the party

Show different players different scene tabs: open **Present to** in the session panel, or right-click the eye of a scene tab, and tick players for that tab. Untick them, or use **Everyone back to the presented scene**, to bring them back.

- Up to 4 scenes at once. The tab you have open is live; players on other tabs keep their last view and are told you are on another scene.
- A badge on a tab's eye says how many players are on it.

### A player comes back

A player who reconnects from the same browser or Obsidian takes their old place, with their tokens, without asking you again. If someone joins with a name already in the session from a different browser or device, the join request warns you; allowing it gives them that player's place.

## For players

### Join from a browser

1. Open the link the GM sent.
2. Type your name (tick **Remember this name** to skip this next time) and click **Join**.
3. Wait for the GM to let you in; the map opens by itself.

### Join from Obsidian

Install Atlas VTT and Connect, run **Join online session…**, paste the link, type your name and click **Join**. The scene opens in its own tab. Keep Connect on the same version as your GM's.

### At the table

- **Move:** drag the tokens the GM gave you (they have a yellow ring). Pan by dragging the map, zoom with the wheel or a pinch.
- **Select a token:** click it with **Move** to select it: its bars, name and wheels grow and its bars show their numbers (hovering shows the numbers too). Press Escape or click the map to let go.
- **Measure:** pick **Measure** and choose a line, cone or circle; it measures in the GM's units, snaps to the grid when the GM has snapping on, and stays two seconds after you let go.
- **Laser:** pick **Laser** and draw to point at something; everyone sees it.
- **Ping:** pick **Ping** and tap the map: rings show at that spot for everyone.
- **Template:** pick **Template** and drag to leave a spell area on the map for everyone. The arrow beside the button opens its menu: **Line**, **Circle/Sphere**, **Square/Cube** or **Cone**. A circle grows from its centre, a square from one corner (snapping to the grid's corners). Each template shows its size in the GM's units: a line's or cone's length, a circle's radius, a square's side. Tap one of yours to remove it, or pick **Clear my templates** in the menu to remove them all. You can keep up to 10.
- **Hover a token** for its name and conditions, and the exact numbers of your own tokens.
- **Your sheets:** the scroll icon on the right edge opens the stat blocks of your tokens; click a highlighted number to roll it. Shift-click rolls with advantage, Alt-click with disadvantage, and a right-click offers both.
- **Initiative:** during a fight the turn order shows as a column at the right of the map, with the current turn highlighted.
- **Dice:** open the dice tray, pick dice and roll. The GM's Atlas rolls them and everyone sees the result.
- **Roll cards:** a new roll shows as a card for a few seconds; **Details** shows the dice, a click dismisses it.
- **Dice log:** the dice icon on the right edge opens every roll of the session.
- **An image from the GM** covers the map: scroll to zoom, drag to pan, double-click to reset, and press Escape or click beside it to close it.
- **Follow GM** puts your view back on the GM's camera; **Fit map** shows the whole map.

## Settings

Settings → Atlas VTT Extension - Connect:

- **Signaling server / My own server:** how players find your session. The default works; set your own server if you prefer.
- **Relay (TURN) servers:** add one if players can't connect from strict networks (some offices, schools, mobile data).
- **Player page:** the web address in join links. Leave the default unless you host your own (see [DEVELOPING.md](DEVELOPING.md)).
- **Keep online images on this device:** a player's Obsidian keeps map images, so the next session loads faster.
- **Log online play events:** writes a diagnostic log to the console, for bug reports.

## What doesn't work yet

On Atlas from Community plugins, Connect reads what Atlas leaves reachable, so a future Atlas release can break parts of it.

- Footprints of tokens seen in the dark aren't shown to players, and edges of sight are a little rougher than in Atlas's window.
- A map with a stretch-fit grid may not line up for players. Running timers show their last saved value. Atlas's marks and pings aren't relayed.
- Templates show their size to players only; the GM sees them without the label.
- **Sharing notes and maps** (People…, Share with…, Ask to pull…, Shared with me…) and per-collection rules need an Atlas build with the extension API, which no released Atlas has yet. That build is installed with BRAT from `evolJoaoBento/atlas-vtt`.

## Privacy

Connect talks to:

- PeerJS cloud signalling (`0.peerjs.com`) to connect players, unless you set your own server;
- the STUN server `stun.l.google.com:19302`, to find a direct route;
- the player page at `evoljoaobento.github.io/atlas-vtt-connect`;
- any relay servers you add.

The game itself goes directly between you and your players. Details in [PRIVACY.md](PRIVACY.md).

## Coming from the online play preview

If you used the fork of Atlas VTT with online play built in, Connect takes over its settings, people and shares on its first start. A map someone shared with you before arrives once as a second scene, e.g. "Inn (2)", the next time it is updated; after that, updates replace it as before.

## Developing

Building, testing and releasing: [DEVELOPING.md](DEVELOPING.md).

## Licence

AGPL-3.0-only, see [LICENSE](LICENSE). Connect contains code from Atlas VTT (AGPL-3.0-only, © Fabian Urbanek) and open-source packages; credits in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
