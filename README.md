# Atlas VTT Extension - Connect

Play [Atlas VTT](https://github.com/ByteMirror/atlas-vtt) maps online with your group. You host from Obsidian; players join from a web page or from their own Obsidian. No accounts, no server to run.

![A player joins and the GM's map opens for them](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/04-allow-player.gif)

Connect is an independent plugin, not made by or affiliated with the Atlas VTT author. It changes nothing in Atlas.

## Install

1. Obsidian 1.8.7 or newer, on desktop.
2. Settings → Community plugins → Browse: install and enable **Atlas VTT**, then **Atlas VTT Extension - Connect**.

**Updating to 0.4.0:** the GM and every player in Obsidian should update together (Settings → Community plugins → Check for updates). The web join page updates by itself. With an older GM, clicking a readable pin says the note couldn't be opened, and a note sent with Send to… never arrives.

## Start a session (GM)

Open a map, click **Online session** in Atlas's toolbar, then **Start online session** and **Copy link**. Send the link to your players.

![Start a session and copy the link](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/02-start-session.gif)

When a player asks to join, a notice says so: **Allow** or **Deny**.

The panel lists who is connected. **×** sends a player out (they must be allowed again); **Stop online session** ends it for everyone.

![Remove a player and stop the session](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/06-session-panel.gif)

A player who reconnects from the same browser or Obsidian takes their old place without asking again. If someone joins with a name already in the session from another device, the request warns you.

## Join (players)

**From a browser:** open the link, type your name (tick **Remember this name** to skip it next time), click **Join** and wait for the GM.

**From Obsidian:** install Atlas VTT and Connect, run **Join online session…**, paste the link and click **Join**. The scene opens in its own tab. Keep Connect on the same version as your GM's.

![Join from Obsidian](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/05-join-obsidian.gif)

## What players see

Players see the scene you present, as Atlas's own player window shows it: hidden tokens, fog and line of sight stay hidden, and your map's look (rings, grid style, pin icons, numbered look-alike tokens) carries over.

**Present a scene:** click the eye on its scene tab; players' maps fade over to it.

![Present another scene](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/08-present-scene.gif)

**Hidden stays hidden:** hide a token and it is gone from players' maps.

![Hide a token](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/09-hide-token.gif)

**Dynamic lighting:** with Atlas's dynamic lighting experiment on, players see only what their tokens see, plus the places they explored.

### Health bars, per token

Resources a collection marks **visible to players** (its settings, Resources) show as bars and small wheels on tokens. To choose per token, right-click it → **Edit Token** → **Players see**. Each resource gets two choices, applied on **Save**:

- **This token**, or **Every *Cleric*** (every token with that statblock, on every map). The token's choice wins over its statblock's, which wins over the collection's.
- **Bar and numbers**, **Bar only**, **Number only** (the current value alone: 19, never 19 / 27) or **Hidden**.

**Bar only:** players see how full it is, not the numbers.

![Bar only](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/13-players-see-per-token.gif)

**Number only:** players read the current value under the token.

![Number only](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/14-number-only.gif)

Choices are kept with your vault, so you can set them while preparing. A token at 0 is greyed under a skull, and comes back when healed:

![Downed and healed](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/17-downed.gif)

### Whose turn

Right-click tokens → **Add to Initiative**, roll, and **Start combat** in Atlas's tracker. With the initiative list shown to players, they get the order at the right of their map, "Your turn is next" on the turn before theirs, and "Your turn" with a white ring when it comes.

![Initiative, "Your turn is next" and "Your turn"](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/15-initiative.gif)

### Readable pins

Right-click a note pin → **Readable by players**. Players see it where they can see that spot, and clicking it opens the note in a side panel: the whole note, or only the heading the pin links, without frontmatter, your `%% %%` comments or embeds.

![Make a pin readable; the player reads its note](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/16-readable-pin.gif)

## Hand over tokens

Right-click a token → **Controlled by** → tick the player. They can drag it (yellow ring); moves snap to your grid, stop at walls on a lit scene, and are refused while you drag.

![Controlled by, then the player moves it](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/18-controlled-by.gif)

Players see the stat block of every token they control, with exact numbers, and roll from it; the roll is made by your Atlas and logged under their name. Mind that this includes a monster you hand to a player.

**Player characters:** mark a token as a player character in Atlas, then give it with **Controlled by**. Connect remembers that player by name and gives them that character on every scene and in later sessions.

## At the table (players)

<table>
<tr>
<td width="50%"><b>Move around.</b> Drag the map to pan, scroll to zoom; <b>Follow GM</b> goes back to the GM's view.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/21-pan-zoom-follow.gif" alt="Pan, zoom, Follow GM"></td>
<td width="50%"><b>Hover and select.</b> Hover a token for its conditions; click to select it and see its numbers. Escape lets go.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/22-select-hover.gif" alt="Hover and select a token"></td>
</tr>
<tr>
<td><b>Measure.</b> Line, cone or circle, in the GM's units, snapping to the grid. It stays two seconds.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/23-measure.gif" alt="Measure"></td>
<td><b>Templates.</b> Line, Circle/Sphere, Square/Cube or Cone, with its size. Tap one of yours to remove it.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/26-templates.gif" alt="Templates"></td>
</tr>
<tr>
<td><b>Laser.</b> Draw to point; everyone sees it, the GM too.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/24-laser.gif" alt="Laser"></td>
<td><b>Ping.</b> Tap the map: rings show there for everyone.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/25-ping.gif" alt="Ping"></td>
</tr>
<tr>
<td><b>Clear my templates</b> in the template menu removes all of yours (you can keep up to 10).<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/27-clear-my-templates.gif" alt="Clear my templates"></td>
<td><b>GM side:</b> each player template has a <b>×</b> on your map; <b>Clear players' templates</b> (command palette) removes them all.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/28-gm-erase-template.gif" alt="GM erases templates"></td>
</tr>
</table>

### Sheets and dice

<table>
<tr>
<td width="50%"><b>Your sheets.</b> The scroll icon opens your tokens' stat blocks; click a highlighted number to roll it on the GM's Atlas.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/29-sheet-roll.gif" alt="Roll from a sheet"></td>
<td width="50%"><b>Advantage.</b> Shift-click rolls with advantage, Alt-click with disadvantage, right-click offers both.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/30-advantage.gif" alt="Advantage"></td>
</tr>
<tr>
<td><b>Dice tray.</b> Pick dice and roll; the GM's Atlas throws them and everyone sees the result.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/31-dice-tray.gif" alt="Dice tray"></td>
<td><b>Roll cards and log.</b> <b>Details</b> shows the dice, a click dismisses the card; the dice icon opens every roll of the session.<br><img src="https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/32-roll-card-log.gif" alt="Roll card and dice log"></td>
</tr>
</table>

Connect follows Obsidian's light or dark theme:

![Light and dark](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/37-theme.gif)

## More for the GM

### Show an image

Run **Show image to players…** and pick an image. Players can zoom, pan, close and reopen it; **Stop showing image to players** takes it away.

![Show an image](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/33-show-image.gif)

### Split the party

Right-click a scene tab → **Present to** → tick players to show them that tab. **Scenes** in Connect's toolbar buttons lists every tab the same way, and **Everyone back to the presented scene** brings them all back. Up to 4 scenes at once; players on a tab you are not on keep its last view.

![Split the party and bring everyone back](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/34-split-party.gif)

### Send a note

During a session, right-click a note → **Send to…** and pick anyone who plays in Obsidian. They are asked to **Allow** or **Decline**; allowed notes land in `Shared/<sender>/`. Players can send notes too, to the GM or each other. Parts you keep private (part tags) stay out.

![Send a note](https://raw.githubusercontent.com/evolJoaoBento/atlas-vtt-connect/main/docs/media/35-send-note.gif)

## Settings

Settings → Atlas VTT Extension - Connect:

- **Signaling server / My own server:** how players find your session. The default works.
- **Relay (TURN) servers:** add one if players can't connect from strict networks (some offices, schools, mobile data).
- **Player page:** the web address in join links. Leave the default unless you host your own (see [DEVELOPING.md](DEVELOPING.md)).
- **Keep online images on this device:** a player's Obsidian keeps map images, so the next session loads faster.
- **Log online play events:** writes a diagnostic log to the console, for bug reports.

## What doesn't work yet

On Atlas from Community plugins, Connect reads what Atlas leaves reachable, so a future Atlas release can break parts of it.

- Footprints of tokens seen in the dark aren't shown to players, and edges of sight are a little rougher than in Atlas's window.
- A map with a stretch-fit grid may not line up for players. Running timers show their last saved value. Atlas's marks and pings aren't relayed.
- Templates show their size to players only; the GM sees them without the label.
- **Sharing maps** and per-collection rules need an Atlas build with the extension API, which no released Atlas has yet. Notes are shared on any Atlas (Send to…, Share with…, Shared with me…).

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
