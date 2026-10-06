# Privacy and network use

Atlas VTT Connect is an independent plugin, not made by or affiliated with the Atlas VTT author. It does nothing on the network until you start an online session, join one, or share or pull something. This file says what then leaves your computer, who receives it, and what stays in your vault.

- No accounts, no telemetry, no analytics, no ads.
- No code is downloaded or executed from the internet, and the plugin does not update itself.
- Connect does not read or write files outside your vault. What it keeps on the device is in Obsidian's own storage and settings (see [What stays on your device](#what-stays-on-your-device)).

## Hosts Connect talks to

While a session you started runs, or while you join one:

- **A signalling server.** The PeerJS cloud at `0.peerjs.com`, unless you set your own under Settings, Atlas VTT Connect (**Signaling server**, then **My own server**). It sees IP addresses and connection ids, and no game data.
- **A STUN server.** `stun.l.google.com:19302`, to find your public address. It sees IP addresses, and no game data.
- **Relay (TURN) servers**, only the ones you add. A relay forwards traffic that is still encrypted between you and a player.
- **Your players, directly.** Data between you and your players is encrypted end to end.

Stopping the session, or closing Obsidian, ends all of it.

The join link you share carries your signalling and relay settings, including any relay username and password you set, so players' browsers can use them. It also carries your table id, which stays the same from one session to the next. The part of the link after the `#` is never sent to GitHub, because browsers do not send it.

Players open the join page from `evoljoaobento.github.io/atlas-vtt-connect` (GitHub Pages) by default. Their browsers load it from there, so GitHub sees their IP address like for any web page. Connect itself never contacts that address; it only builds links to it. You can change the address under **Player page** in Settings, Atlas VTT Connect, and host the page yourself. Browsers give every site under `evoljoaobento.github.io` the same storage, so the join page should stay the only site published there, or move to its own address.

## What players receive

The players you let in receive the scene they are on, filtered on your computer before it is sent, with file paths replaced by fingerprints of the files' contents (which only tell whether two images are the same file). They also receive the map and token images of that scene, as the original files, and no other file from your vault.

That scene is the one you present, unless you assigned the player to another tab (split party, see the README). Each player receives only their own scene: its records, images, token ids and names, your view and lasers on it. Images are checked per player, so a page that asks for another scene's image is refused. A scene you are not on is paused: its players keep what they already have and get nothing new from it, except that a change you make to what players may see (the player view settings, or a collection's resources and rules) is applied to it at once. Who is on which scene is never sent to players; they see everyone's names in the session, as before. The one thing about another scene a player can receive is its name, in the dice log (see below).

What players never receive:

- Tokens wholly under fog that is not revealed. A token shows when part of it is revealed, as in your player window. Texts and drawings are sent only when they are wholly revealed. A partly covered cell counts as fogged, and the parts of a shape outside the map never make it visible. Pins are never sent during play; they travel only in player-safe shares (see below).
- With dynamic lighting on, anything the lighting hides from your players' tokens: tokens, texts and drawings in the dark are never sent. If Connect cannot tell what is lit (the map is still loading, or Atlas cannot compute it yet), players get only the dark map: no tokens, texts or drawings.
- Walls, lights, light zones and how tokens see. Which side a combatant is on is sent, but not why.
- Resource names and numbers. Players see a bar for each resource your collection shows to players, with a fill rounded to hundredths, and the HP bar in the initiative list.
- Hidden tokens.

The map image is sent whole, so the parts of the picture under fog of war are visible to anyone who inspects the page. Tokens wholly under fog, and texts and drawings that are not wholly revealed, are not sent.

Players also receive:

- the initiative list as your player window shows it: for a collection that fights by sides, the combatants under their side and no initiative numbers, and a number only where the window shows one. A creature is marked as downed when a resource that defeats it is spent, even one you keep from players;
- where your view of their scene is (its centre and how much of the map it shows), so their view can follow yours. Nothing about your view is sent while you look at another scene;
- where your laser pointer is, while you point on their scene;
- your game system's cone angle with your measurement settings;
- the widgets (timers, counters and the like) that players can see, with their label, icon and value;
- the ids of their own tokens, and nothing else about them;
- for each token they receive, what your player window shows of it: its name on a nameplate and in the initiative list (when the collection's rules show them), its conditions with their values (including "invisible" on a token they can see), its rotation and its ring colour;
- the grid's size, type and offset for snapping, also while the grid itself is hidden from players;
- your fog of war as the shapes you painted and erased, not as a picture, so the page can tell where each stroke went.

Players can move the tokens you assign to them under **Controlled by**. For each move their page sends Connect only the token and the spot where they let go, and Connect asks Atlas to apply it with the same checks as a GM drag. Players cannot send anything else that changes your scene. Assignments are kept only while the session runs.

### Dice and lasers

While a session runs, players receive every dice roll Atlas makes: the formula, each die (and whether it was rolled for an exploding die or subtracts), the total, whether it was a critical success or failure by your collection's dice rules, and who rolled it. That is the player's name, or a statblock token's name only to players who can see that token with its name on their own scene (everyone else reads "GM"), or "GM". While more than one scene is in use, a player's roll also carries the name of the roller's scene, as its tab is named, to every player, including players on other scenes. Only the player who made a roll receives it marked as their own. Players' rolls use your collection's dice rules. The join page keeps the player's **Roll display** choice in that browser.

Players' measurements and drag rulers stay on their device. Their lasers go to the other players on the same scene, and to you while you have that scene open; their dice rolls go to everyone in the session. Lasers are not stored. Players' rolls show in your dice log for as long as the map stays open, and are not saved into your map files.

## Joining a session from Obsidian

When you join with Connect (**Join online session…**), it connects to the signalling and relay servers the join link names, the STUN server, and directly to the GM, only while the dialog waits for the GM and while the scene is open. The GM receives the name you enter, that you joined from Obsidian, and the same things a web player sends. You in turn receive the GM's name: the name the GM last joined with, or "GM". Nothing you receive is written into your vault unless you pull it (see below): the scene is kept in memory only. Connect remembers the last name you joined with in its settings.

## Device keys and table keys

When you and others play from Obsidian, Connect identifies each of you with a key that stays on your device. Joining sends a signature made with it and the public key, never the private key.

- **The GM's table key** is kept in Obsidian's local storage on this device, never in the vault. Obsidian keeps local storage per vault on each device. Connect's settings file (`plugins/atlas-vtt-connect/data.json` in the vault's configuration folder) holds no part of the table key. It holds only public table ids: which table came over from the online play preview (so only the first device takes that key) and the last 20 tables replaced with **New table key** (so no device takes their keys again). A vault you sync, copy or hand to players from now on does not carry the key.
  - Each device you host from has its own table, and players who know one table meet a new one on another device. Clearing Obsidian's app data on a device also loses its table key; Connect then makes a new one, and players are approved again.
  - Versions of Connect before this kept the key in its settings file. On its first start, Connect moves the key to local storage, reads it back, and only then removes it from the file. If local storage refuses that key, it stays in the file and Connect tries again on the next save. A key that was never in the file (a new one, or the preview's from this device) never goes into it: if local storage refuses it, Connect keeps it in memory until Obsidian closes and says so once. Update Connect on every device that opens the vault: an older version writes the key back into the settings file.
  - Copies made before this version still hold the old key: copies of the vault, the history of a sync or Git backup and, after moving from the online play preview, Atlas's settings (`atlas-vtt/.atlas-data/settings.json`, and with Atlas 0.6 also its synced `.obsidian/plugins/atlas-vtt/data.json`). If any of these reached someone else, choose **New table key** (a command, and a button in Connect's settings). Connect asks first and refuses while a session is running. Every player must then be approved again: they join as new devices, which you can link to their people.
- **A player's device key** is kept in Obsidian's local storage on this device, one per table, never in the vault or in Connect's settings file. Obsidian keeps local storage per vault on each device, so a second vault or device is a new device to the GM, who can link it to the person.
- **The people list** (names, device ids, when they were last seen) is kept in `atlas-vtt/.atlas-data/extensions/atlas-vtt-connect/sharing/people.json`: the GM's for everyone admitted, a player's for the people they met.

## Sharing notes and maps

Nothing is shared until you share it, and only with the people you pick. What leaves your computer is decided on your computer, before anything is sent:

- Private parts (`%%[!private]%%` … `%%[!end]%%`), parts meant for other people (`%%[!only|…]%%`, `%%[!except|…]%%`), and `%% comments %%` are removed. Comments are removed everywhere, including inside code, and an unclosed `%%` removes the rest of the note.
- Parts meant only for you arrive marked, so if you share the note on, they stay with you and the sender. Such a part arrives wrapped in `%%[!only|…]%%`, naming the sender and the people at your table it was also meant for, as person ids your Connect turns into the names in your people list; anyone it does not know is left out.
- Text that cannot be read fails closed: a tag Connect cannot read hides what it marks from everyone, a tag that is never closed hides the rest of the note, an `atlas-share` entry it cannot read is kept back rather than sent, and a name after `except` that is not in your people list hides that part from everyone. A tag written inside code or a link is not used, and keeps the rest of the note back. Text that looks like a tag but is not one, including the old `> [!private]` callouts, hides the rest of the note. Names of people you remove are never given to someone else. A `%%[!end]%%` that closes nothing stops the note from being shared at all until you fix it.
- Properties are removed except those listed under **Shared note properties**, and the `atlas-share` property itself is never sent. Links to notes the person does not get become plain text.
- File paths never leave your computer. Shared items get random ids, and a map's paths are cleared or replaced by references.
- A player-safe map holds what online players see. A map saved with dynamic lighting on is never shared player-safe; share it Full or switch its lighting off. Nor is a map whose lighting Atlas does not report, or one with more fog than online players can be sent (over 10,000 fog strokes, or fog Connect cannot read): its fog could not be proven to hide what it hides. Pins under fog of war, GM-only pins and pins whose note you did not tick are left out, as are tokens, texts and drawings under fog. A note you tick is sent whole, even when its pin or token is under fog or hidden, so tick only notes your players may read. A full map holds the whole map as a co-GM would see it, including hidden tokens, GM-only pins, walls, lights, light zones, the camera, the whole initiative list with its numbers, the widgets and their values (also those players cannot see), the token settings, the GM's fog and whether the tracker is open, so Connect asks you to confirm it.
- Sharing settings are not part of collection bundles: exporting a collection leaves them out (a scene's share and the `atlas-share` property of every exported note) and importing one drops them, including any legacy sharing data of the online play preview. The rest of an exported note is not filtered: a bundle is your own release.

Items go only to someone who pulls them, during a session, over the same encrypted connection as the game. The people you share with see each item's title, kind and size as soon as you share it; the content needs a pull. A relaying GM sees these too.

**The GM sees relayed items in clear.** Items between two players pass through the GM's Obsidian. It forwards them piece by piece and stores none of them: it writes nothing to its vault and keeps no record once the transfer ends. But each connection is encrypted separately, so the GM's Connect handles those items in clear while it forwards them, and the GM could read anything players share with each other. There is no end-to-end encryption between players.

What you pull is written into your vault: notes into `Shared/<person>/`, maps and their images into the **Shared with me** collection. Connect also keeps, in `atlas-vtt/.atlas-data/extensions/atlas-vtt-connect/sharing/` (which Obsidian does not index), the last pulled version of each note, its merge history and a list of what you pulled from whom. Removing a person from your people list does not delete what you already pulled.

**Pulled notes can hold code.** A note can contain code that other plugins run, or HTML that loads from the internet. Connect looks for these known kinds: code blocks for plugins such as Dataview, Datacore or JS Engine (any code block whose language names JavaScript, TypeScript, Dataview, Datacore, an engine or Templater, so some plain `js` blocks are flagged too), inline Dataview JS (`$=` anywhere in the note, also written with HTML entities), Templater commands, HTML such as `<script>`, `<iframe>`, `<frame>` and `<webview>`, and some HTML that loads from the internet (`<style>`, and `<img>`, `<link>`, `<audio>`, `<video>` or `<source>` with a web address). If those plugins are installed, such code runs in your Obsidian, with access to your vault and your computer, as soon as the note is written (Templater, when it runs on new files) or shown. When a pulled note holds any of these, Connect says which kinds before writing anything, on every pull, also for a note pulled with a map. **Pull without code** (the default) keeps the text but makes those kinds inert: such code blocks become plain `text` blocks, and the rest is escaped (`<\%`, `&lt;`) or, inside code, broken with an invisible character so code examples still read the same. **Pull as is** writes the note as received. Other plugins can run other kinds of code that Connect does not know, so pull only from people you trust. Images and other web content in a pulled note, including Markdown images with a web address and HTML Connect does not flag, load from wherever they point when the note is shown, which can reveal your IP address, and when you opened the note, to whoever hosts them.

## What stays on your device

- **In your vault:** your notes and maps as usual, the people list and sharing records above, and what you pull.
- **In Connect's settings file:** `plugins/atlas-vtt-connect/data.json` in the vault's configuration folder holds your online settings, including any relay username and password (players receive these in the join link). It holds no private key.
- **In Obsidian's storage on this device, outside the vault:** the table key and the device keys, under `atlas-vtt-connect:` names (Obsidian keeps these per vault, on each device) and, with **Keep online images on this device** on (the default), the images you received, up to 500 MB. Switching it off deletes them. The images are shared by all vaults on the device.
- **In the player's browser, on the join page:** with **Keep images on this device** on (the default), the images it received, up to 500 MB, until the player switches it off or chooses **Clear saved images**. With it off, images are kept only while the page is open. The page also keeps the player's name, a random player key per session, for its last 20 sessions (it is tied to the GM's random session id, so it identifies nobody across sessions), the keep-images switch, the diagnostics switch and the display choices (roll display, laser colour).

## Moving from the online play preview

Atlas VTT Connect copies the preview's online settings into its own settings from Atlas's plugin data (`.obsidian/plugins/atlas-vtt/data.json`, where the preview keeps them from its 0.6 on), or, when that holds none, from `atlas-vtt/.atlas-data/settings.json` (where earlier versions kept them). It takes the preview's table key into Obsidian's local storage on this device, in this order: the preview's own key on this device (kept there from the preview's 0.6 on), else the one in those settings. It never edits Atlas's files or removes the preview's key, so an old copy of the key can stay in Atlas's settings file (and, with Atlas 0.6, in its synced plugin data) until you remove the `online` entry by hand while Obsidian is closed. If such a copy reached someone else, choose **New table key**. Nothing is sent anywhere.

Atlas VTT Connect copies, and never removes, what the preview kept:

- the folder `atlas-vtt/.atlas-data/sharing`, with your people list, your share and pull records, and the last pulled text and merge history of notes others shared with you;
- the preview's device keys, in Obsidian's local storage;
- the preview's kept session images (its image database on this device).

The folder stays in your vault until you delete it; the notice shown after the move names it. Delete it once you've checked your people and shares. The device keys and images stay in Obsidian's storage on this device; Connect never removes them, and turning off **Keep online images on this device** clears only Connect's images.

Atlas VTT Connect sends none of this anywhere. A sync tool you use may copy these files, including Connect's own settings file in the vault's configuration folder, which holds no private key. Atlas's settings files may still hold the preview's table key until you remove it.

## Clipboard

The clipboard is written only when you choose a copy action, for example copying a join link.
