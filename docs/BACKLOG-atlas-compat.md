# Connect: Atlas compatibility backlog

Written 2026-10-28 from Atlas VTT's patch notes (0.2.0 to 0.10.2) against a quick search of Connect's code (0.6.2).
Nothing here was run against a live Atlas. **Verify** means "check Connect's behaviour first; it may already be right".
Atlas versions are in brackets. Order is priority: P0 first, and inside a tier top to bottom.

## Done

- [x] Atlas 0.10 levels: players get only the floor a view shows (0.6.2)
- [x] Dice rules per collection: default roll, critical rule, exploding (0.5.0)
- [x] Custom stat block templates, and Atlas's own card (0.4.0, 0.5.0)
- [x] Dynamic lighting read from Atlas 0.9.1 (0.6.0)
- [x] A stat block's Rollable setting kept online, rolls named after the label before the number (0.6.2)
- [x] Valued conditions, per-token resource visibility

## P0: what players see must match Atlas (leaks or wrong pictures)

- [x] **Token numbers (0.10.2).** Fixed 2026-10-28, not yet released. Connect now ports Atlas 0.10.2's rule (`K2e`): a token whose art two or more tokens of the scene share, hidden, fogged and off-map ones counted, shows its own stored `instanceNumber ?? 1`. Nothing is renumbered, and a bad stored number is cleaned to a whole number from 1 to 9999. Removed `instanceNumbers.ts` and the memo field. Tests: `instanceBadges.test.ts`. Verified by code and tests, not live.
- [x] **Hidden tokens give players no sight and no explored area (0.7.0).** Verified 2026-10-28 by code: Connect computes no sight at all. `LiveLighting.ts` and `stockLighting.ts` take Atlas's own `playerVisibility` (its player sight and token perception), so this is Atlas's rule, mirrored. Risk is only that the stock shim reads Atlas's private objects: retest on each Atlas release. Not tested live.
- [x] **Tokens and door icons under fog are hidden from players, with their names and rulers (0.7.0).** Verified 2026-10-28 by code and tests. Tokens: dropped with their name, statblock name and art (`unsentTokensLeak.test.ts` checks the whole scene JSON and the asset registry; `projectForPlayers.test.ts` covers fog and hidden tokens and initiative entries). Doors and walls: only the Tabletop board path sends them, and it checks fog (`projectBoard.test.ts`, door-under-fog case added). Rulers: Connect relays no GM rulers or drag paths to players (the only tool messages are dice, lasers, pings and players' own templates), so nothing to hide.
- [x] **A roll shows its token picture and name only when players can see that token (0.7.0).** Verified 2026-10-28 by code and tests. Connect names a statblock roll after its token only if that token is in what was last sent to players (a hidden or fogged one is not), else "GM"; the log entry has no picture field at all. The ability stays, which is Atlas's own rule (`PlayerDiceToasts`: a hidden token's roll "keeps its ability and result but not the token's name or portrait"). Tests: `diceHost.test.ts` (new case: no name, picture or token fields in anything sent, the ability kept), and the existing hidden and fogged cases.
- [x] **Measurements that start on an unseen token are hidden from players (0.7.0).** Verified 2026-10-28: not applicable. Connect's protocol carries no GM measurement. The only shapes it relays are templates players place themselves at free points (`map-template`), with no link to a token.
- [x] **Light and sight edge cases (0.10.0, 0.10.2).** Verified 2026-10-28 by code, no change needed. Connect computes none of it: it reads Atlas's own sight, perception and light reach through the stock shim, so Atlas's fixes (a token at a light's edge, magical darkness, one-way walls) come with Atlas. Checked against the 0.10.2 build: every member the shim reads still exists (`playerSight`, `sightIsCurrent`, `currentSight`, `ambientLight`, `lightReaches`, `playerFramePerception`, `getTokenRenderer`), and the sight object's shape and sense values (`all`, `regions`, `bright/dim/dark/magicalDark`, `as-bright`, `as-dim`, `reveals`, `lineOfSight`, `precise`) match what the shim validates. Not run live. Open: Tabletop's own 3D lighting is separate and not covered here. The sub-items below are the original list.
  - a token exactly at a light's edge is lit from both sides or neither
  - magical darkness, including a small light outshining it, giving the next token sight
  - one-way walls: no thick black line where they stop a light
- [x] **Grid alignment that turns or shifts the map (0.7.1; fixed for Atlas Online in 0.10.2).** Done in Connect 2026-10-28, committed locally, not released. Atlas keeps a map's alignment as `grid.mapStretch` (factors 1 to 1.5, a turn of at most 5 degrees) and, per level, `levelAlignments` (stretch, scale, offset). The world rect Connect already sends is the aligned image's box, so a pure stretch was already right. A turn or an offset left the image misplaced against the grid and tokens. Connect now reads the shown level's effective alignment in the stock shim (`mapAlignment`), ports Atlas's own rules (`mapPlacement.ts`: `Uf`, `Fan`, `CA`, `$4`, `oxe`, `xH`), and sends a six-number matrix as the optional `map.matrix`, only for a turned or shifted map. The 2D page draws it (`ViewSurface.imageMatrix`). Older pages ignore the field and draw as before. The web player page must be republished to get it. Tests: `mapPlacement.test.ts` checks the matrix against a copy of Atlas's `xH` at many points; projection, validation (a bad matrix is refused, a missing one is fine), the map layer and the shim snapshot are covered. Verified by code and tests, not live.
  - [ ] **Tabletop's 3D player board and its own GM board.** Open, in the Tabletop repo. Its board takes its world size from the image's natural pixels (`board.ts` `buildSurface`), so on a stretched map (even a pure stretch) tokens sit in Atlas's world, not the image's. It needs the world rect, the map plane placed by the matrix, and for the GM board Atlas's own alignment. The matrix already arrives in the player scene's `map`.

## P1: map and scene content

- [ ] **Animated maps: WebM and MP4 as the background (0.10.0).** Half done 2026-10-28 (committed locally, not released): players get a still of the video's first frame as the map. Before, a video map had no file type in Connect's list, so players saw a blank grey map. Now `vaultImageFiles` takes the first frame from the video's own URL (never reading the video into memory), the registry gives it the id of that PNG whatever the video's size, and the rest (hashing, serving, the player's decoding) is unchanged. Tests: `animatedMapStill.test.ts`. Atlas's own online play does the same for its baseline (`Could not take the still of an animated map`). **Open: the video itself playing for players.** Needs a video file type through the asset protocol (older pages refuse an unknown type), a player-side `<video>` drawn every frame (the page now repaints on change, not continuously), the same in Tabletop's 3D board, and a transfer plan. The GM's Obsidian uploads to each player separately over WebRTC, so cost is size times players: a 50 MB loop to 5 players is 250 MB uploaded, at an assumed 1 to 5 MB/s per player (not measured). The limit today is 64 MB a file. My estimate: several days, and impossible to check without a live Atlas.
- [ ] **Generated dungeons' animated water, lava and acid (0.10.0).** Spiked 2026-10-28, nothing built. Connect sends players none of it, so a generated dungeon reaches them without its liquids. In Atlas a liquid is a record in `objects.liquids`: `{ id, kind: 'liquid', liquid: 'water' | 'lava' | 'acid', polygon, holes?, flow?: {x, y}, colors: { surface, deep, glint }, art?: 'engraved', lavaLight?, level? }`, drawn by a shader layer over the map (its snapshot captures use `stillFor()`, so it is not part of the map image). Atlas's own online play already sends it in that shape. Two steps: (1) **static fill**: a new `liquids` record in the player scene, a layer under the fog and darkness (so fog hides it, as it hides the map), filled with the surface colour and cut by the holes; small, testable, and the honest first step; (2) **animation**: a port of Atlas's shader to the 2D page and to Tabletop's 3D board, which is the real work. Needs the user's call on both.
- [ ] **Replace map image (0.10.0).** A video, a gridless version or a larger export in place of the same map, keeping grid, walls and tokens.
- [ ] **Huge maps, up to 144 megapixels, and SVG maps (0.7.0).** Check the transfer size caps and the player page's memory use. No image size limit found in the player code.
- [ ] **Level switching for players (0.10.0).** Connect sends the one floor the GM views. Check what Atlas Online lets players do, then decide.
- [ ] **Per-scene distance per cell (0.6.0), cell numbering A1, B1 (0.6.0), cone shapes follow the game system (0.5.0).** *Verify the player ruler.*
- [ ] **Tokens glide to their place (0.7.0).** *Verify the player view.*

## P1: stat blocks

- [ ] **Built-in templates (0.8.0).** 5e 2014 and 2024, Cairn, Draw Steel, Fate, generic creature, NPC and hazard. Connect can't read built-ins, so its text fallback treats them as 5e. Atlas's card is correct. Options: carry the built-in definitions into Connect, or ask Atlas for them.
- [ ] **`@` references in templates (0.9.0, 0.9.1).** `1d8 + @str.mod`, and references by label (`@str`). Resolved on Atlas's card, not in the text fallback.
- [ ] **Counters, tracked numbers, recovery actions (short and long rest), boxed numbers and gauges (0.9.0).** The card shows them; the text fallback shows the raw value.
- [ ] **Tracked values written like `15 (natural armor)` (0.9.1), and `0` showing on tokens (0.8.0).** Make Connect's resource projection accept both.
- [ ] **Several tokens sharing one statblock (0.8.0).** *Verify sheets and HP are per token, not per note.*

## P2: dice

- [ ] **Foundry and Roll20 notation (0.8.0).** Keep and drop (`2d20kh1`), rerolls, explosions, success counts, `d%`, Fate dice and labels. Atlas rolls the GM's side; the text-sheet formula pattern misses rerolls, success counts, `d%` and Fate dice.
- [ ] **Dropped and rerolled dice struck through (0.8.0).** *Verify the dice log.*
- [ ] **Players roll with advantage or disadvantage by right-click or long-press (0.9.1).** *Verify the page's own tray.*
- [ ] **Public dice rolls toggle (0.7.0).**
- [ ] **Dice Lab sets (0.8.0).** Own colours and names, and advantage and disadvantage edge rules (keep best, add or subtract a number, add or subtract a die). Connect's online tray doesn't read them. Tabletop does as of 2026-10-28; reuse its `rollRules.ts`.
- [ ] **Invalid or oversized formulas rejected with a clear message (0.7.0).** *Verify the player's message.*

## P2: initiative and turns

- [ ] **Audit Connect's initiative against Atlas (0.5.0 to 0.9.0).** Cards, more sides, sides that re-roll each round, delay turns, a turn banner, a ring on the active token, add combatants without placing them, start from an encounter, off-map combatants.
- [ ] **Players can click a combatant in the list to find its token (0.9.1).**
- [ ] **GM can let players move only on their turn (0.9.0).**

## P3: Atlas Online parity (large, optional)

These are Atlas Online features. Doing them would bring Connect's player side close to Atlas Online's.

- [ ] Campaigns, and a Players tab with player-character values shared across scenes and devices (0.8.0)
- [ ] Tokens of the same player character share hit points (0.9.0)
- [ ] Players edit every value on their sheet, including maximums (0.9.1)
- [ ] Abilities, Inventory and Notes panels on the player's sheet (0.9.0, 0.10.2)
- [ ] Send items from random tables and bases to players (0.9.0)
- [ ] Clickable dice rolls in the player view (0.9.0)
- [ ] Player-visible resource wheels, a switch per resource (0.8.0). *Verify; Connect has per-token visibility.*

## P3: platform and upkeep

- [ ] **Atlas runs in the main Obsidian window only (0.10.2).** A popped-out Atlas moves back. Check Connect's scene tabs and any popout assumption.
- [ ] **Stock shim fragility.** Connect reads Atlas's private objects. 0.10.0 fixed a crash with third-party Atlas plugins, so retest on every Atlas release, and move to the extension API when Atlas ships one.
- [ ] **Library sync (0.6.0).** Atlas's library now syncs through Obsidian Sync and others. Check Connect's own stored data is sync-safe.
- [ ] **Translations (0.6.0, 0.9.0).** Atlas follows Obsidian's language (Russian, Simplified Chinese). Connect's strings are English only.
- [ ] **Cosmetic parity:** toasts matching the theme (0.8.0), animated grid detection (0.8.0).

## Not Connect's job

Dungeon generator, random encounters, encounter builder, Armarium store, asset manager changes, map and token importers, grid auto-detection (Spectral Engine), the Atlas Dice browser extension, and Atlas Online's hosted service.
