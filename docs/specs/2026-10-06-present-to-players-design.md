# Present to players (split party): design

- **Date:** 2026-10-06
- **Status:** implemented. Atlas: API batch 16 (API 1.17.0, `scene-tabs`) at `api-pr-16-end` (`bc7bccc6`). Connect: plan tasks B1–B13, for Connect 0.1.0-beta.4 with the Atlas API build 0.6.0-beta.5. This document describes what was built; section 12 lists where it differs from the first draft.
- **Plan:** `docs/plans/2026-10-06-present-to-players.md`
- **Repos:**
  - Atlas: `C:\Users\joaoo\2075\atlas-vtt-upstream-wt`, branch `api/extension-api`. The findings were read at `api-pr-15-end` (12e9b106). Batch 16 ends at `api-pr-16-end` (`bc7bccc6`), which Connect vendors.
  - Connect: `C:\Users\joaoo\2075\atlas-vtt-connect`, branch `main`.
- **User requirements (binding, 2026-10-06):**
  - The GM can use any number of scenes at once, each assigned to any set of the online players, and can move players between them.
  - Assignment is opt-in. With no assignment a player follows the scene Atlas presents, as today.
  - Players are assigned from two places: a "Present to:" button in the Online session panel, and a "Present to" section in the menu that opens when you right-click a scene tab's eye.
  - One click brings everyone back to the presented scene.

---

## 1. What the code allows (findings)

These facts decide the shape of the design. References are to the Atlas worktree unless they say Connect.

1. **Atlas has one live scene per map view, and one map view.**
   - Each `AtlasView` has one `atlasStore` and one PIXI renderer.
   - `switchToTab` (`src/app/atlas-view.ts:370-419`) does four things in order:
     1. flushes the open tab's pending saves;
     2. caches only that tab's undo history (`temporalCache`) and viewport (`viewportCache`);
     3. activates the new tab;
     4. reloads the new tab **from its file** into the same store (`performSceneLoad`).
   - **A background tab has no live state.** It exists only as its file plus the two caches.
   - `mergeDuplicateAtlasLeaves` (`src/app/plugin/atlasLeaves.ts:59-73`) folds any second Atlas leaf back into the first as tabs. A file cannot be open twice either: `onLoadFile` reuses the open tab.
   - So two different vault scenes are never live at the same time. "Open in another pane" does not occur for vault maps; only remote views and the player window are separate leaves.
2. **Every live API answers for the active tab only.**
   - `views.snapshot(viewId)` and `views.subscribe` read the view's store. `SceneSnapshot` carries no tab id. During a switch, `loaded` is false and `mapPath` follows the loading.
   - `lighting.playerVisibility(viewId)` is computed by the view's renderer (`playerVisibility.ts:48-80`), so it is `pending` while a tab loads.
   - `tokens.move`, `lasers.show`, `lasers.onLocal` and `views.camera` are also keyed by view.
   - `scenes.readMap(mapPath)` reads a file from disk. For a background tab the file is current, because leaving a tab flushes its saves. It has no explored memory and no lighting answer.
3. **Presentation.**
   - There is one `PresentedScene` per vault, identified by view and tab, with a `presentationId` that is new on every `present()` (`src/app/services/PresentedScene.ts`).
   - It holds when its view leaves the tab, resumes once the tab is loaded again, and clears when the tab or the view closes.
   - The player window mirrors the GM view's own canvas, freezes its last frame on hold (`PlayerWindowService.holdCurrentFrame`), and can only show the active tab.
   - The eye (`SceneTabBar`, `src/app/react/tabPresenting.ts`) presents the tab. Its right-click menu is hard-coded to "Open player window" and opens only while a presentation target is active.
4. **Tabs through the API.**
   - `ViewInfo.tabs` (`{ tabId, mapPath, name }`) and `activeTabId` come from `views.list()` and the `map-loaded` event.
   - No event fires when a background tab is closed, renamed or reordered.
   - The only way to switch a tab is `presentation.present(viewId, tabId)`, which also changes the presented scene.
5. **Menus.**
   - Atlas's menu (`AtlasContextMenu.tsx`, Radix, portaled from a global provider) takes `item`, `submenu` and `custom` entries.
   - A submenu with function children re-reads them on `subscribe`. The root entries are fixed when the menu opens, so a top-level checkmark does not follow a change (the API 1.13.0 note).
   - There is no menu slot on a scene tab or its eye.
6. **Connect is built around one scene.**
   - One `SceneBroadcaster` projects once per tick, diffs once, and sends the same messages to every admitted player (`SceneBroadcaster.ts:208-228`). The file is at the 300-line cap.
   - One `PresentedSceneSource`, `LiveScene` and `CameraProjection.currentProjection()` feed the `CameraSender`, `TokenMoveHandler`, `LaserRelay`, `DiceHost` and `AssetServer`.
   - The `AssetServer` allow-set is global (`AssetServer.ts:108-119`).
   - `ControlLists` sends every assigned token id, whatever its scene.
   - `DiceHost` rolls with the presented scene's map path and names a roll after a token of the one projection.
   - On resume, `showScene` keeps the `sceneId` and memo, restarts the lighting and sends a **full snapshot** (`SceneBroadcaster.ts:120-138, 149-162`). On a lit scene the lighting is `pending` at that moment, so players get `closedFrame` (no tokens, all dark) until sight is ready. With one scene this is a rare flash. With a split party the GM switches tabs often, so it would happen on every switch.
7. **Protocol.**
   - `PROTOCOL_VERSION = 1`.
   - An unknown `type` decodes as `ignored`, and validators accept extra fields, on both sides (`protocol.ts:160-182`).
   - A `v` mismatch gets `denied 'version'`.
   - `PlayerScene.sceneId` is random per presentation. `scene-camera`, `token-move` and `laser` carry it.

**Consequence.** "N scenes at once" means N tabs of the GM's one view. Exactly one tab is **live**: the active tab, which Atlas has loaded and renders. Every other scene in use is **parked**: its players keep the last projection Connect made while it was live, as players of a held presentation do today. Making every scene live at the same time is out of scope (section 10), and section 8 explains its cost.

---

## 2. Goals

1. **Split party.** At any moment each online player sees exactly one scene. The scene is either the one Atlas presents (the player *follows*) or a tab the GM *assigned* them to. Several groups can be on different scenes at the same time.
2. **Opt-in.** With no assignment, what players receive while a scene is presented and live (every message, its order and its content) is what Connect sends today. Atlas's own player window always shows the presented scene.
   - Three deliberate changes touch an unsplit session, and only around hold:
     - a held scene sends `scene-state paused` (unsequenced, so an older page is unaffected);
     - a resume sends a patch, not a full snapshot, after lit sight is ready (D14);
     - a held scene is re-projected on a rules change (D8).
   - Each is tightening or cheaper, and each has its own test.
3. **Two ways to assign**, both with checkable players: a "Present to:" button in the Online session panel, and a "Present to" section in the eye's right-click menu. Plus one click: "Everyone back to the presented scene".
4. **Live where the GM is.** The scene on the GM's active tab is live for its players: moves, fog, lighting, camera and lasers. A parked scene stays as its players last saw it, and the page says so.
5. **Privacy.** A player never receives anything from a scene they are not on: no record, image, camera, laser, token id or token name. The one exception is the scene *name* in the shared dice log, which the user asked for (decision D7).
6. **Cost.** One live projection per tick whatever N is, and nothing re-projected for a parked scene except on a rules change. The number of scenes in use is capped at 4.

---

## 3. UX

All wording is sentence case. Player names and scene (tab) names are shown as given.

### 3.1 Terms

| Term | Meaning |
|---|---|
| Presented scene | Atlas's presented scene (the eye's presented tab). Followers see it. |
| Follower | A player with no assignment. The default. |
| Assigned | A player pinned to a tab of the GM's view that is not the presented one. |
| Scene in use | The presented scene, plus every tab at least one player is assigned to. |
| Live / parked | A scene in use is live while it is the GM's active, loaded tab, and parked otherwise. |

### 3.2 The "Present to:" button (Online session panel)

- It sits in the presenting block of `OnlinePresenting`, below "Players see {scene}." and the existing "Present to players" and "Stop presenting" buttons.
- It acts on **the GM's active tab** in the Atlas view.
- Its label summarises who sees that tab:
  - "Present to: everyone": the tab is presented and nobody is assigned elsewhere.
  - "Present to: Anna, Ben": the players who see that tab, either as followers of a presented tab or as assigned players. After three names it becomes "Present to: Anna, Ben and 3 more".
  - "Present to: nobody": no player sees that tab.
- Opening it:
  - **Click, Enter or Space** toggles the popover.
  - **Hover** opens it after 300 ms and closes it 300 ms after the pointer has left both the button and the popover. A popover opened by click or keyboard stays open until Escape, a click outside, or the button again.
- The popover is Connect's own React checklist inside the panel, not an Obsidian `Menu`. An Obsidian menu closes on every pick, and the GM ticks several players in a row (decision D11).
- Contents, top to bottom:
  1. A heading: "Present {scene} to".
  2. While a row is disabled by the cap, the note "At most 4 scenes at once" under the heading.
  3. One checkbox row per admitted or disconnected player, in the panel's player order. The rows behave as in 3.4.
  4. A separator, then "Everyone back to the presented scene" (3.5).
- No admitted or disconnected players: one disabled row, "No players connected".
- No GM map view or no active tab: the button is disabled and reads "Present to: no scene open".

### 3.3 The eye's right-click menu (Atlas, through the batch 16 slot)

- Right-click the eye of any scene tab, or press the context-menu key or Shift+F10 with the eye focused, to open Atlas's menu at the eye.
- From API 1.17.0 the menu opens whenever it has something to show, not only while a target is active.
- Order:
  1. Atlas's own "Open player window", while a presentation target is active, as today.
  2. A separator, then Connect's section:
     - heading row "Present to";
     - while a row is disabled by the cap, a disabled first row "At most 4 scenes at once". Atlas reads a section's heading once, when the section is added, so the note cannot go into the heading;
     - the player rows of 3.4 for **that** tab, or one disabled row "No players connected";
     - "Everyone back to the presented scene".
- Connect adds its section only while it is hosting. Not hosting: the menu has only Atlas's own entry, and it opens only while a target is active, as before.
- The rows are top-level checkable items with `keepOpen`, so the GM ticks several in a row. The batch 16 menu re-reads its sections after `ui.invalidate()`, so the checkmarks follow (A2).

### 3.4 Player rows (the same builder for both menus)

For a tab T and a player P:

| P's state | Row label | Checked | Choosing it |
|---|---|---|---|
| Follows, and T is presented | `Anna` | yes, disabled | nothing (to send Anna away, tick her on another tab) |
| Follows, and T is not presented | `Anna · on {presented scene}`, or `Anna · no scene` when nothing is presented | no | assign Anna to T |
| Assigned to T | `Anna` | yes | unassign: Anna follows the presented scene again |
| Assigned to another tab U | `Anna · on {U}` | no | assign Anna to T (moves her from U), or, when T is presented, unassign her |
| Disconnected | the same, with ` · disconnected` | as above | as above; the assignment applies when she returns |
| Would open a 5th scene in use | as above | no, disabled | nothing; the menu gains the note "At most 4 scenes at once" (3.2, 3.3) |

- Rows that change something run at once. They need no confirmation, because every step can be undone with one more click.
- **Choosing a row for a tab that has never been live** in this session (no parked projection) first switches the GM's view to that tab with `views.showTab`, the batch 16 addition. Connect can only project the active tab, and the GM sees what they hand out (decision D4). The menu stays open while its tab becomes active (A2 pins this).

### 3.5 Everyone back to the presented scene

- **Where:**
  - the last row of both menus;
  - a button in the panel's presenting block, shown only while at least one player is assigned;
  - the command "Bring all players back to the presented scene": in Atlas's palette, and as an Obsidian command registered only on an Atlas with `scene-tabs`.
- **Effect:** clears every assignment. Every player then follows the presented scene and gets its snapshot.
- **Disabled** when nothing is assigned, or when no scene is presented. In the second case it would blank every screen, and the GM can untick players one by one instead (decision D9).

### 3.6 Panel status while split

- With at least one assignment, the presenting block reads "Players see {scene}. 2 players are on other scenes." Singular: "1 player is on another scene."
- Each assigned player's row in `OnlinePlayerList` gains a chip "On {scene}". Followers get no chip, as today.
- At the cap: "Players are on 4 scenes, the most at once. Bring players back to free one."
- Older Atlas (no `scene-tabs` capability): one line in the presenting block, "Update Atlas VTT to show different scenes to different players.", and no "Present to:" button, eye section, badge or Obsidian command.

### 3.7 The eye's marker

- While at least one player is assigned, every tab with players on it shows a short badge after its eye: "1 player" or "3 players", the count of players who see that tab (followers count for the presented tab).
- A tab with a badge draws its eye in the "shown" style even when it is not the presented tab.
- With no assignments there are no badges, as today.
- The badge comes from `PresentationTarget.tabBadge`, the batch 16 addition, on Connect's online target. It reads the session store when Atlas calls it, and Connect calls `ui.invalidate()` on every store change. Atlas draws it in an `atlas-scene-tab__badge` span and also reads it into the eye's accessible name.

### 3.8 What players see

- **Reassigned:**
  1. The page clears the scene.
  2. It shows the new scene.
  3. Its camera follows the GM's camera for that scene again (a new `sceneId` resets the follow, as today).
  4. Drags, previews and lasers in progress are dropped.
  - There is no "moved" notice, because the player's own screen already shows the change.
- **Parked** (`scene-state` with `paused: true`): a banner over the map reads "The GM is on another scene. You can't move tokens until they're back."
  - Moves are refused, as for a held scene today (`token-move-refused`), and the token snaps back.
  - The dice tray and the laser keep working.
  - The banner goes when the scene is live again.
- **Dice log:** it stays one shared log. While more than one scene is in use, each player roll is labelled with the roller's scene name: "Anna · Cave". GM rolls and single-scene play show no label.
- **Following with nothing presented:** "Connected to {title}. Waiting for the GM to show a scene.", as today.

---

## 4. Data model (Connect, session memory only)

```ts
/** A tab of a GM map view. Tab ids are unique per view and survive renames. */
interface TabKey { viewId: string; tabId: string }
function tabKeyOf(tab: TabKey): string;                 // `${viewId}\u0000${tabId}`
function sameTab(a: TabKey | null, b: TabKey | null): boolean;

/** The one rule of where a player is: their tab, else the presented one, else none. */
function resolveScene(assigned: TabKey | null | undefined, presented: TabKey | null): TabKey | null;

type AssignResult = 'ok' | 'follows' | 'cap';           // 'follows': the presented tab, stored as follow

/** Who is pinned where. Absent: follows the presented scene. Never holds the presented tab. */
class SceneAssignments {
  assign(playerId: string, tab: TabKey, presented: TabKey | null): AssignResult;
  unassign(playerId: string): void;
  clear(): string[];                                      // Everyone back: who was assigned
  tabOf(playerId: string): TabKey | null;
  sceneOf(playerId: string, presented: TabKey | null): TabKey | null;   // resolveScene
  dropTab(tab: TabKey): string[];                         // a closed tab: the players sent back
  dropView(viewId: string): string[];
  presentedChanged(presented: TabKey | null): string[];   // D15
  retainPlayers(known: ReadonlySet<string>): void;        // drops kicked players
  scenesInUse(presented: TabKey | null): TabKey[];        // the presented one first
  wouldExceedCap(playerId: string, tab: TabKey, presented: TabKey | null): boolean;
  assignedCount(): number;
  entries(): Record<string, TabKey>;                      // a copy, for the GM's store
  onChange(listener: (playerIds: string[]) => void): () => void;
}

/** One scene in use (`SceneSlot`): the presented scene's slot, or an assigned tab's slot. */
class SceneSlot {
  readonly tab: TabKey;
  readonly sceneId: string;           // random; kept while the slot lives (parked included)
  state: 'waiting' | 'live' | 'parked';
  lastSent: PlayerScene | null;       // what its players have
  name: string;                       // the tab's name and map path, kept current on tabs-changed
  mapPath: string;
  // Private: the kept snapshot and lighting frame (to re-project while parked, D8), the projection memo, the cached
  // snapshot messages, the fog coverage and the lighting watcher (both dropped while parked), and the sight wait (P8).
  shownSnapshot(): SceneSnapshot | null;   // live, attributed (P2), caught up, not waiting for sight (P8)
}
```

- **Resolution.** `sceneOf(player) = assignments.tabOf(player) ?? presentedTab`, where `presentedTab` is `{ viewId, tabId }` from `presentation.current()`, or null.
  - A slot's **audience** is the admitted players who resolve to its tab.
  - The presented slot lives while something is presented. Its `sceneId` is new for every `presentationId`, exactly as today.
  - An assigned slot lives while it has at least one assigned player, connected or not. When the last one leaves it, its memory is freed.
- **Live attribution.** Data belongs to a tab only when the snapshot is `loaded` and its `tabId` (batch 16, `SceneSnapshot.tabId`) equals the tab's id (`TabScenes.liveSnapshot`).
  - `TabScenes` (`src/app/online/atlas/tabScenes.ts`) also has `isActive(tab)`, `watch(viewId)`, `camera(viewId)` and `watchCamera(viewId)`. `isActive` reads `activeTabId` only to decide whether a slot is live or parked, never to attribute data. It is the only Connect file that reads `activeTabId`.
  - The hub's read side (`SlotProjection`: `slotOf`, `liveSlot`, `shownSlot`, `shownSnapshot`, `audience`, `splitActive`, `scenesInUse`, `onSlotChange`, `watchLive`) is what the camera, assets, control, lasers and dice read.
  - An admitted player whom the hub has not placed yet resolves to the scene their admission sends. So an asset request that arrives before the admission's snapshot is checked against the player's own scene.
  - Without `scene-tabs` (an older Atlas) there is only the presented slot, attributed as today (by presentation and `loaded`), and the split feature is hidden (decision D12).
  - `activeTabId` alone never attributes anything, because it changes before the store reloads.
- **Persistence.** None. Assignments live in the hosted session. Player ids are per session, and a new session starts with everyone following (decision D10).
- **Rules that keep the model small:**
  - Assigning to the presented tab stores nothing: the player follows.
  - Presenting a tab with the eye (a new presentation) turns every player assigned to it into a follower.
  - A tab that closes drops its assignments.
  - A kicked player is dropped. A disconnected one is kept.
- **GM state for the UI:** `onlineSessionStore` gains `split: 'on' | 'unsupported'`, `assignments: Record<playerId, TabKey>`, `assignedCount` and `scenesInUse` (`src/app/online/splitStore.ts`).
  - They are written from the hub's slot changes, never from `projected` (every live tick), and only when they differ by value: every store change makes Atlas read its slots again.
  - The menus, the panel and the badge resolve each player with `resolveScene`, over the store's `assignments` and Atlas's `presentation.current()`. Tab names come from `views.list()`, so a rename or an admission shows at once.
  - Both menus share one row builder (`gm-ui/presentToRows.ts`). The cap comes from the hub (`wouldExceedCap`) and is never worked out again in the UI.
  - `SceneHub.scenes()` (`SceneUse[]`: tab, name, presented, player ids and state) stays available as a read. The UI does not use it.

---

## 5. Protocol

`PROTOCOL_VERSION` stays **1** (decision D6). Raising it would make every older page get `denied 'version'`. Everything below is additive, and an older client ignores it.

### 5.1 Changes

1. **Reassignment uses existing messages.** The player gets, in sequence order:
   - `scene-clear`;
   - `scene-snapshot` of the new slot (its own `sceneId`) with its fog and drawing parts;
   - `scene-camera` for that `sceneId`, when the slot has one;
   - `token-control` with the player's tokens in that scene;
   - `scene-state` (below).
2. **New GM → player message `scene-state`:**
   ```ts
   { v: 1; type: 'scene-state'; sceneId: string; paused: boolean }
   ```
   - It is **not sequenced** and carries no `seq`, like `scene-camera`.
     - An older page decodes it as `ignored`.
     - A sequenced message it never applies would leave a hole in its `seq` run, so its next `scene-patch` would look like a gap (`PlayerSceneMirror.receive`: `seq !== lastSeq + 1` → `lost()` → `scene-resync`). The player would then get a full snapshot after every pause.
   - The control channel is a reliable, ordered PeerJS data channel (`PeerTransport.ts:208`), so a `scene-state` sent after a snapshot arrives after it. It is scoped by `sceneId`.
   - It is sent when a slot turns parked or live, after every snapshot of a parked slot, and on resync.
   - A held presented scene with no assignments is parked too, so its followers get `paused: true`. This is the one message an opt-in session gains (Review Focus 1).
   - Validation: `sceneId` matches `SCENE_LIMITS.idLength`, and `paused` is a boolean. A `sceneId` that is not the shown scene's is ignored.
3. **`DiceLogEntry.scene?: string`.**
   - The roller's scene name, plain text, trimmed, at most 64 characters. A name that fails validation is dropped; the roll is kept.
   - Present only while more than one scene is in use, and only on player rolls.
4. **`DiceLogEntry.name` is now worked out per recipient.**
   - A roll named after a token keeps the token's name only for recipients whose scene shows that token.
   - Everyone else sees "GM".
   - The field's shape is unchanged.
5. **`token-control.tokenIds`, while a split exists** (at least one assignment), lists only tokens in the recipient's current scene projection. It is sent again on reassignment, and whenever that scene's projected token set gains or loses one of the player's tokens.
   - With no assignment it is today's list (every assigned id, sent when control changes), so an unsplit session is unchanged.
   - When the last assignment goes, every player gets today's list once.
   - A player moved to a tab that was never live gets an empty list before that tab's first snapshot. The real list follows the snapshot.
6. **Player → GM is unchanged.**
   - `token-move` and `laser` already carry `sceneId`. The GM now checks each against **the sender's** slot.
   - `scene-resync` resends the sender's slot.

### 5.2 Older clients

| Client | What it does with the new GM |
|---|---|
| Web page or Obsidian player of Connect 0.1.x | `scene-state` decodes as `ignored`, so no paused banner: moves on a parked scene are refused and snap back without a reason. `DiceLogEntry.scene` is ignored: no label. Reassignment works, because it is clear plus snapshot. |
| Same client, GM's Atlas before 1.17.0 | The feature is hidden on the GM side. Nothing changes on the wire. |
| New client, older GM (Connect 0.1.x) | Never receives `scene-state` or `scene`, so it behaves as today. |

- The new client's validators accept `scene-state` only when it is well formed.
- The page keeps today's behaviour for anything it cannot read.

---

## 6. Privacy

These rulings are binding and each has a test in the plan.

- **P1, one audience per message.** Every scene message (snapshot, part, patch, clear, camera, `scene-state`, laser relay) is built from one slot and sent only to that slot's audience. The audience is worked out at send time, after any reassignment.
- **P2, no attribution by tab id alone.** A snapshot, lighting answer, GM laser (`lasers.onLocal`) or GM camera belongs to a slot only when `snapshot.loaded && snapshot.tabId === slot.tab.tabId`. During a switch from A to B, nothing derived from A reaches B's audience, and nothing from B reaches A's. This is the plan's biggest risk (Review Focus 2).
- **P3, clear before a new scene.** Reassignment sends `scene-clear` first, so a mirror never mixes two scenes, even on an older page that ignores `scene-state`.
- **P4, assets per player.** The `AssetServer` allow-set becomes `allowedFor(playerId) = sceneAssetIds(slotOf(playerId).lastSent)`. On reassignment, the player's in-flight transfers outside the new set are cancelled (`asset-cancel` handling already exists per transfer), and further requests get `asset-denied`.
- **P5, token ids and names.** While a split exists, `token-control` and dice-log token names are worked out per recipient against their slot's projection, as in 5.1. A player never learns the id or name of a token in another scene. Dice names are always per recipient, which gives today's result for a single scene.
- **P6, lasers and camera.** A player's laser is relayed only to their own slot's audience, and only if the laser's `sceneId` is that slot's. The GM's laser and camera feed only the live slot. A parked slot's camera is its last one.
- **P7, parked is not new.** A parked slot keeps only what its audience already has. On a change of the player view settings, or of a collection's resources or initiative rules, it is re-projected from its kept snapshot and lighting frame. That can only apply the GM's new rules (decision D8).
- **P8, fail closed under lighting.** Going live on a lit scene, Connect keeps the parked projection and sends nothing new until `playerVisibility` is `ready` or `unlit`. After 2 seconds it projects with `closedFrame`, as today. A lit scene without the `lighting` capability is closed, as today.
- **P9, names only, as asked.** The dice label carries a scene's tab name to players on other scenes. That is the only cross-scene datum (decision D7). The privacy note in `PRIVACY.md` and the README says so.
- **P10, presence is unchanged.** `presence` lists every player's name, as today. It says nothing about who is on which scene.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| **A tab closes while players are on it** | `tabs-changed` (batch 16) shows the tab gone. Its assignments are dropped, its players follow the presented scene (clear plus snapshot), and the GM gets the notice "Anna and Ben went back to the presented scene: Cave was closed." If it was the presented tab, Atlas clears the presentation. Followers get `scene-clear` and wait, as today; assigned players elsewhere are unaffected. |
| **The view closes** | Every slot goes. Assignments are dropped and everyone waits, as today. |
| **A tab is renamed or its file moves** | The tab id stays, so the slot stays. Names in the UI and the dice label follow `tabs-changed`. |
| **A player disconnects and returns** | The assignment is kept by `playerId`, which is stable within the session through `playerKey`. On re-admission they get their slot's cached snapshot, camera, control list and `scene-state`, not the presented scene. Kicked players lose their assignment. |
| **A player with no assignment** | Follows. With nothing presented: "Waiting for the GM to show a scene." |
| **Hold** | A held presented scene is a parked slot: its followers keep the last projection and get `paused: true`. If the GM's new active tab is an assigned slot, that slot goes live. A presentation that *starts* held still clears followers first, as today (`holdScene`). |
| **The GM presents another scene** | Followers move to it (new presentation, new `sceneId`). Assigned players stay where they are. Players assigned to the newly presented tab become followers and get the new presented slot's snapshot. |
| **A lit scene** | Live: `LiveLighting` as today. Going live: P8. Parked: the last frame is kept. Without `lighting`: closed, plus the existing notice. |
| **A tab never live is assigned** | Connect calls `views.showTab` and the GM's view switches to it. Its players see "Waiting for the GM to show a scene." until it loads and is projected. If `showTab` answers false (closed, overtaken), the assignment is undone and the GM gets "Couldn't open {scene}." |
| **Assigning would open a 5th scene** | Refused in the UI (disabled row) and in `SceneAssignments.assign` (`'cap'`). |
| **The GM switches tabs quickly A → B → C** | Each slot goes parked as soon as its snapshot stops matching it. B goes live only if a loaded B snapshot arrives. `showTab` answering false for an overtaken switch undoes nothing that was already live. |
| **A move arrives for a parked scene** | Refused with `token-move-refused`, as for hold. |
| **A resync from a parked player** | Their slot's cached snapshot, plus `scene-state paused`. |
| **An oversized or fog-truncated scene** | Per slot, the existing clear plus notice, sent only to that slot's audience. |
| **Connect without the vendored 1.17.0 types** | Not possible after B1. Atlas without `scene-tabs` hides the feature (D12). |

---

## 8. Performance

### 8.1 This design (one live, N parked)

- **Per tick (50 ms):** only the live slot is projected and diffed. The cost is today's cost, whatever N is.
- **Fan-out:** every player still receives one scene's stream. The patch is built once per slot and sent to that slot's audience, so total bytes per tick are at most today's.
- **A GM tab switch:**
  - Atlas reloads the tab from its file, the same cost as today.
  - Connect subscribes to the new live slot, waits for lighting (P8, at most 2 s), and projects once with the slot's kept memo, so unchanged records cost a reference check.
  - It then **diffs against the parked projection and sends a patch** when the `sceneId` is unchanged. Today a full snapshot is sent on every resume; for a heavy scene that is hundreds of KB to every player of that scene on each switch.
  - The old slot sends one `scene-state paused` to its audience.
- **Reassignment:** the cached snapshot messages of the target slot (`SnapshotCache`), with no re-projection. The player's page fetches images it lacks, and the page keeps them in IndexedDB.
- **Memory per parked slot:**
  - `lastSent` plus cached snapshot messages: at most about 4 MB at the record limits (10,000 records, 192 KiB parts), typically under 200 KB.
  - The kept `SceneSnapshot` is Atlas's frozen objects, already shared.
  - The kept `LightingFrame` darkness grid is at most `MAX_CELLS` bytes.
  - **Dropped while parked:** the `FogCoverage` raster, which can reach 4 M cells (a summed-area table of about 16 MB), and the `LiveLighting` watcher. They are rebuilt when the slot goes live or is re-projected on a rules change. That takes tens of ms, once.
- **Bound.** `maxPlayers` is 12, so there can be at most 13 slots. With the cap of 4, the worst case is about 16 MB, and the typical case under 1 MB.

### 8.2 Making N scenes live at once (out of scope, and why)

- **Atlas would need, per extra live tab:**
  - its own store, loaded and kept in sync with autosave and undo;
  - its own background textures (a large map is 100-250 MB of GPU memory);
  - its own sight frames rendered on the GPU after every change, because `playerVisibility` reads the view renderer's sight.
- That is an Atlas architecture change (one store and renderer per view, leaves merged), not an API addition.
- **On the Connect side, live N would mean, per tick:** N projections, N diffs, up to N fog coverage rasters (16 MB each at worst) and N lighting rasters.
- Today's 50 ms tick budget would no longer hold past 2 or 3 heavy scenes.

### 8.3 The cap: at most 4 scenes in use

- **Ruling:** at most 4 scenes in use per session, counting the presented one.
- **Reason:** the GM can only run one scene at a time. Four covers a party split three ways plus the main scene, and keeps the menus and badges readable. It also bounds parked memory (about 16 MB at worst) and the images on offer.
- **Enforced:** in `SceneAssignments.assign` and by the disabled rows. The panel states the cap at the limit (3.6).
- **Constant:** `SPLIT_LIMITS.scenesInUse = 4` in `src/app/online/split/splitLimits.ts`.

---

## 9. API batch 16 (API 1.17.0, capability `scene-tabs`)

- Batch 16 builds on batch 15 (API 1.16.0, `dice-looks`). It starts after batch 15's last commit and tag (`api-pr-15-end` is re-tagged by its owner if batch 15 adds commits), and it ends at `api-pr-16-end`.
- **Typing:** new members on shipped namespaces are optional (`?`), per the 1.12.0 rule. Everything is attached only with `has('scene-tabs')`.
- **Not added (decision D3):** live state or player visibility for a non-active tab. Findings 1 and 2 show this needs per-tab stores and GPU sight, not an API, and section 8.2 gives the cost. Connect parks instead.

| # | Addition | Why Connect needs it | Today's gap |
|---|---|---|---|
| 1 | Event `'tabs-changed': (view: ViewInfo) => void` | Notice a closed, renamed or moved tab, and active-tab changes, without polling | Nothing fires for a background tab |
| 2 | `SceneSnapshot.tabId?: string \| null` | Attribute a snapshot to a tab exactly (P2) | The snapshot has no tab; `activeTabId` runs ahead of the store |
| 3 | `views.showTab?(viewId, tabId): Promise<boolean>` | Switch to a never-live tab without presenting it (D4) | Only `presentation.present` switches, and it presents |
| 4 | `ui.addSceneTabMenuSection?(section): Disposer` | The "Present to" section on the eye | No slot; the eye menu is hard-coded |
| 5 | `PresentationTarget.tabBadge?(tab): string \| null` | The "2 players" marker | No way to mark a tab |

### 9.1 Signatures

```ts
// types/views.ts
interface SceneSnapshot {
  /** 1.17.0: the tab whose scene this is, set once `loaded`; null while loading and in remote views. */
  readonly tabId?: string | null;
}
interface ViewsApi {
  /**
   * 1.17.0 (`scene-tabs`): makes a tab of a GM map view active without presenting it.
   * Answers true once that tab's map is loaded. Answers false for a closed, unknown or remote view,
   * an unknown tab, or when another switch overtook this one. Never throws for these.
   */
  showTab?(viewId: ViewId, tabId: string): Promise<boolean>;
}
// types/api.ts, the events map
'tabs-changed': (view: ViewInfo) => void; // 1.17.0: a GM map view's tabs (added, closed, moved, renamed) or active tab changed

// types/ui.ts
interface SceneTabMenuContext {
  viewId: ViewId; tabId: string; mapPath: string; name: string;
  /** The view's active tab. */ active: boolean;
  /** Atlas's presented tab, held or not. */ presented: boolean;
}
interface SceneTabMenuSection {
  /** Shown as a label row at the section's top; plain text, at most 40 characters. */
  heading: string;
  /** Read when the menu opens and again after `ui.invalidate()` while it is open. Return [] to leave the section out. */
  items(context: SceneTabMenuContext): MenuItem[];
}
interface UiApi {
  /** 1.17.0 (`scene-tabs`): a section in the menu that right-clicking a scene tab's eye opens. */
  addSceneTabMenuSection?(section: SceneTabMenuSection): Disposer;
}

// types/presentation.ts
interface PresentationTarget {
  /**
   * 1.17.0: a short mark after a tab's eye ("2 players"), or null for none. At most 24 characters,
   * plain text. A tab with a mark draws its eye as shown. Read on render and after `ui.invalidate()`.
   * A throw shows no mark and is logged once.
   */
  tabBadge?(tab: { viewId: ViewId; tabId: string }): string | null;
}
```

### 9.2 Atlas behaviour

- **`tabs-changed`:**
  - Fired from the `ViewTracker` on a `tabMetaStore` change of `tabs` (by id, path, name and order) or `activeTabId`.
  - Coalesced per microtask, with one call per view carrying the new `ViewInfo`.
  - Never fired for remote views. `map-loaded` and `map-closed` are unchanged.
- **`SceneSnapshot.tabId`:**
  - Set by `viewInfo.ts` from the view's `tabMetaStore` when the store is loaded and `mapPath` equals the active tab's `filePath`. Otherwise null.
  - It is part of `snapshotSlice`, so a subscriber hears the change.
- **`views.showTab`:**
  - Calls `view.switchToTab(tabId)` and resolves when `whenMapLoaded` sees that tab loaded.
  - A second call or switch in between resolves the first with false.
  - The presented scene holds as on any switch.
- **Scene-tab menu:**
  - `sceneTabMenuSlot` in `src/app/extensions/slots.ts`.
  - `openPresentMenu` (`tabPresenting.ts`) becomes `openSceneTabMenu`: Atlas's own entry when a target is active, then one separator and label row per section, each item converted by `menuEntries.ts`.
  - It opens when the entry list is not empty.
  - The root menu takes `entries` as a function plus `subscribe` (the mechanism submenus already use), subscribed to the UI slot version, so top-level checkmarks follow `ui.invalidate()`.
  - A provider that throws leaves its section out and is logged once.
  - New `ContextMenuEntry` type `'label'` for the heading row: not focusable, with `aria-hidden` off and role `presentation` on its text.
- **`tabBadge`:**
  - `SceneTabBar` asks every active target, first non-null wins, through the existing `useSyncExternalStore(subscribePresentationTargets…)`.
  - It renders the text in an `atlas-scene-tab__badge` span after the eye.
  - It adds the text to the eye's `aria-label`. There is no `title` attribute, per Atlas's rules.
  - The text is truncated with CSS at 24 characters.

### 9.3 Docs and contract cases

- `docs/extension-api.md`:
  - a table row `1.17.0 | … | scene-tabs | views.showTab, ui.addSceneTabMenuSection (optional) | tabs-changed`;
  - one "Version 1.17.0 adds …" paragraph per addition;
  - a section ``## Scene tabs (`scene-tabs`, 1.17.0)``.
- Contract cases, which Connect's FakeAtlas must pass:
  - `C-tabs-1`: `tabs-changed` on close, rename and switch;
  - `C-tabs-2`: `tabId` null while loading, set once loaded;
  - `C-tabs-3`: `showTab` true once loaded, false when overtaken or unknown;
  - `C-tabmenu-1`: sections are re-read after `invalidate`;
  - `C-badge-1`: a badge thrown or too long.

---

## 10. Out of scope

- Live play on a scene that is not the GM's active tab: moves, fog and lighting changes while it is parked. Making it possible needs the per-tab stores and sight of 8.2.
- More than one Atlas map view, or pane, showing vault scenes. Atlas merges them by design.
- Per-player vision. All players of a scene share the player window's visibility, as today.
- Atlas's own player window showing an assigned scene. It always shows the presented scene, and holds while the GM is elsewhere.
- Remembering assignments across hosted sessions or Atlas restarts.
- A context menu on the scene tab itself; only the eye has one.
- Projecting a never-live tab from `scenes.readMap` without switching. That would mean no explored memory and fail-closed lighting; D4 picks switching.
- Dice rolls scoped per scene. The log stays shared.
- Telling players which scene others are on.

---

## 11. Decisions taken

| # | Ruling | Reason |
|---|---|---|
| D1 | N scenes = N tabs of the GM's view. One is live, the rest are parked at their last projection. | Atlas keeps one live store and renderer per view and reloads a tab from its file. |
| D2 | A held presented scene is a parked slot, with the same rules. | One mechanism. Today's hold already behaves this way. |
| D3 | No API for live state or visibility of a non-active tab. | It needs per-tab stores and GPU sight, not an API (8.2). |
| D4 | Assigning a never-live tab switches the GM's view to it (`views.showTab`). | Only the active tab can be projected, and the GM sees what they hand out. |
| D5 | Moves on a parked scene are refused, and the page says why. | Atlas can only move tokens of the active tab. This matches hold. |
| D6 | `PROTOCOL_VERSION` stays 1, and everything is additive. | A bump locks every older page out with `denied 'version'`. |
| D7 | The dice log stays shared, and player rolls carry the roller's scene name only while more than one scene is in use. | The user asked for it. A tab name is GM-chosen metadata, not scene data. A single scene shows nothing new. |
| D8 | A parked slot is re-projected from its kept snapshot and frame on a change of the player view settings or of a collection's resources or initiative rules. Image changes reach only the live slot. | A GM who hides something expects it hidden everywhere. This tightens today's hold, which waits for resume. |
| D9 | "Everyone back" is disabled while nothing is presented. | It would blank every screen at once. |
| D10 | Assignments are session memory only. | Player ids are per hosted session. |
| D11 | The panel's "Present to:" opens Connect's own popover, not an Obsidian `Menu`. | An Obsidian menu closes on every pick, and the GM ticks several players in a row. |
| D12 | Without `scene-tabs` the feature is hidden, with an update note. | Without `tabs-changed` and `tabId`, closed tabs and switches can't be attributed safely (P2). |
| D13 | At most 4 scenes in use, the presented one included. | One GM runs one scene at a time; this bounds parked memory and keeps menus readable (8.3). |
| D14 | Going live on a lit scene keeps the parked projection until sight is ready (at most 2 s), then sends a patch, not a snapshot. | It avoids a darkness flash and a full resend on every tab switch. Nothing new is sent before it is known. |
| D15 | Presenting a tab with the eye turns players assigned to it into followers. | "Present" means "to everyone who follows". It keeps the model free of pins to the presented tab. |
| D16 | Ticking a follower on the presented tab does nothing (the row is checked and disabled). To move them, tick them elsewhere. | A follower has no other place to be sent. |
| D17 | Only the eye gets the menu slot, not the whole tab. | That is what was asked, and it is the smallest slot. |
| D18 | Dice token names are always per recipient. `token-control` is filtered per scene only while a split exists. | P5: no ids or names from another scene. Without a split there is one scene, so today's list stays and opt-in holds. |
| D19 | `scene-state` is unsequenced and scoped by `sceneId`. | An older page ignores it. A sequenced message it never applies would read as a gap and force a resync. |

---

## 12. Differences from the first draft

The sections above describe what was built. It differs from the first draft in these places:

1. **`SceneAssignments`** follows the plan's shape (section 4).
   - `assign` takes the presented tab and answers `'follows'` for it.
   - `clear` and `dropView` return who went back, and `scenesInUse` returns the tabs.
   - `entries` and `resolveScene` were added for the GM's store.
2. **The GM's store** holds `split`, `assignments`, `assignedCount` and `scenesInUse`, not a `scenes` list (section 4).
3. **The cap note** is a disabled first row in the eye menu, because Atlas reads a section's heading once (3.3). In the panel it is a line under the heading.
4. **D8** covers a collection's resources and initiative rules, as well as the player view settings.
5. **`TabScenes`** gained `isActive`, `watch`, `camera` and `watchCamera`. `LiveLighting` and the presentation lighting gained `pending()` for the P8 wait, instead of keeping a last frame.
6. **Before placement,** an admitted player resolves to the scene their admission sends (section 4).
7. **On a never-live tab,** a player gets an empty `token-control` first (5.1).
8. **The badge class** is `atlas-scene-tab__badge`, following Atlas's naming (9.2).
9. **The Obsidian command** "Bring all players back to the presented scene" is registered only on an Atlas with `scene-tabs` (3.5).
10. **`SceneHub.currentProjection()`** stays as an `@internal` read for tests. No part of the session sends from it.
