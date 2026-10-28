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
- [ ] **Grid alignment that stretches or rotates the map (0.7.1; fixed for Atlas Online in 0.10.2).** The player's map must line up with the grid.

## P1: map and scene content

- [ ] **Animated maps: WebM and MP4 as the background (0.10.0).** Connect sends images only. Needs a transfer path, a size cap, and a player-side video element.
- [ ] **Generated dungeons' animated water, lava and acid (0.10.0).**
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
