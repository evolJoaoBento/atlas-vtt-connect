# Present to Players (Split Party) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The execution method is already chosen: **subagent-driven**.

**Goal:** Let the GM show different scenes to different online players. Each player follows the scene Atlas presents unless the GM assigns them to another tab. There are two ways to assign:
- the "Present to:" popover in the Online session panel;
- the "Present to" section of the scene tab eye's right-click menu.

"Everyone back to the presented scene" undoes every assignment in one click.

**Spec (binding):** `docs/specs/2026-10-06-present-to-players-design.md`.
- Its "Decisions taken" (D1–D18) and its privacy rulings (P1–P10) bind every task.
- Where this plan and the spec differ, the spec wins.

**Architecture:**
- **One live scene.** Atlas has one live scene per view. Connect projects only the GM's active, loaded tab (the *live* slot). Every other scene in use is a *parked* slot that keeps its last projection, as a held presentation does today.
- **Track A (Atlas, API batch 16, API 1.17.0, capability `scene-tabs`).** Five small additions:
  - the `tabs-changed` event;
  - `SceneSnapshot.tabId`;
  - `views.showTab`;
  - `ui.addSceneTabMenuSection`;
  - `PresentationTarget.tabBadge`.
- **Track B (Connect).** The changes, in order:
  - The single `SceneBroadcaster` becomes a `SceneHub` of per-tab `SceneSlot`s, with an audience per slot.
  - `CameraSender`, `AssetServer`, `ControlLists`, `TokenMoveHandler`, `LaserRelay` and `DiceHost` ask "which slot is this player on" instead of "what is the projection".
  - The protocol gains `scene-state` and `DiceLogEntry.scene`, staying at `v: 1`.
  - The panel and the eye menu share one row builder.

**Tech stack:** as in `docs/plans/2026-10-04-extension-api-and-connect.md`: TypeScript 5.8.3, Vitest 4.1.11 (jsdom), React 19.1.0, zustand 5.0.3. Atlas also uses PIXI v8 and Radix menus.

**Base:**
- Track A starts after batch 15 (API 1.16.0, `dice-looks`) is committed and tagged. Today the worktree still has batch 15's dice changes uncommitted, so A1 waits until `git status --short` is clean and its last tag exists.
  - Call that tag `<B15>`: it is `api-pr-15-end` if batch 15 is re-tagged there, or whatever tag batch 15 ends at.
- Track B starts after Connect's queued B20 (the re-vendor at batch 15) has landed.

**Numbering:** task ids in this plan are local to it (A1–A4, B1–B13). User-facing wording is "API batch 16", never "PR". The local tag is `api-pr-16-end`.

---

## Global Constraints

Every constraint of `docs/plans/2026-10-04-extension-api-and-connect.md` → "Global Constraints" applies unchanged:
- no `npm run build` or `npm run dev` in the Atlas worktree;
- no copying into a vault;
- explicit `git add <path>` only;
- the commit attribution paragraph;
- the changelog rules and `changelog:generate`;
- the plugin ids;
- the code rules of `atlas-vtt-upstream-wt/CLAUDE.md`: explicit return types, at most 300 lines per file, no stub data outside tests, SCSS, no `title` attributes, no duplicated logic.

Also:

- **Atlas verify block.** Every A task runs it, from the worktree root, with `API_BASE_REF=<B15>`. The fork-leak guard line must print nothing.
- **Connect verify block.** Every B task runs it, from the Connect root:
  ```bash
  npx tsc --noEmit && npm run lint && npx vitest run && npm run build && npm run check:vendor
  ```
- **No protocol bump.** `PROTOCOL_VERSION` stays `1` (D6). Any diff that changes `protocol.ts:12` fails review.
- **Opt-in guard.** The existing suites must pass **unmodified**, except where a task names the case it changes and why:
  - `sceneBroadcaster.test.ts`
  - `sceneSyncEndToEnd.test.ts`
  - `cameraSender.test.ts`
  - `tokenMoveHandler.test.ts`
  - `laserRelay.test.ts`
  - `diceHost.test.ts`
  - `assetServer.test.ts`
  - `controlLists.test.ts`
- **No `activeTabId` attribution.** `grep -rn "activeTabId" src/app/online/scene src/app/online/atlas` may only match `tabScenes.ts` (B3).

## Review Focus

These are the conditions most likely to hurt a real table. Each has a pinned test in the owning task.

1. **Opt-in stays opt-in.**
   - Expected: with no assignments, the message stream equals today's while the scene is live. The only differences are the three hold changes of spec Goal 2: an unsequenced `scene-state`, a patch on resume, and re-projection of a held scene on a rules change. `token-control` is unchanged without a split (D18).
   - Tests:
     - B5 `sceneHub.test.ts › with no assignments every player gets exactly what SceneBroadcaster sent`. A recorded stream from today's broadcaster over the `sceneSyncEndToEnd` script; it may differ only in the `scene-state` lines.
     - B5 `sceneHub.test.ts › a held scene resumes with a patch, not a snapshot`.
2. **A tab switch leaks scene A into scene B's audience** (the biggest risk).
   - Expected: data is attributed only by `loaded && snapshot.tabId === slot.tabId` (P2).
   - Tests:
     - B5 `sceneHub.privacy.test.ts › during a switch from A to B nothing derived from A reaches B's players`;
     - B9 `laserRelay.split.test.ts › the GM's laser during a switch reaches neither audience`;
     - B6 `cameraSender.split.test.ts › a camera from the loading tab is sent to nobody`.
3. **A player receives another scene's data through a side channel** (assets, token ids, dice token names, lasers).
   - Expected: everything is per recipient.
   - Tests:
     - B7 `assetServer.split.test.ts › a player on A is denied an image only B uses`;
     - B8 `controlLists.split.test.ts`;
     - B9 `diceHost.split.test.ts › a roll named after a token on B reads GM for players on A`;
     - B13 `splitPartyEndToEnd.test.ts › no byte of B reaches a player on A`.
4. **A lit scene flashes dark, or shows too much, when the GM switches back.**
   - Expected: the parked projection is kept until sight is ready, then patched. Still pending after 2 s: closed (P8).
   - Test: B5 `sceneHub.lighting.test.ts`.
5. **The eye menu's checkmarks go stale, or the menu closes, while ticking.**
   - Expected: sections are re-read after `ui.invalidate()`, the menu stays open while its tab becomes active, and a never-live tab switches.
   - Tests:
     - A2 `sceneTabMenu.test.tsx › checkmarks follow invalidate in the top-level menu`;
     - A2 `› stays open while its tab becomes active`;
     - B12 `sceneTabMenu.test.ts`.
6. **An older page or an older Atlas.**
   - Expected: an older page works, without the banner. An Atlas without `scene-tabs` hides the feature and shows the update note.
   - Tests:
     - B2 `protocol.split.test.ts › an older decoder ignores scene-state and the dice scene`;
     - B11 `onlinePanel.split.test.tsx › without scene-tabs shows the update note and no Present to button`.

---

## File structure

**Atlas (Track A)**

| File | Change |
|---|---|
| `src/api/version.ts` | `API_VERSION = '1.17.0'` (A1) |
| `src/api/capabilities.ts`, `src/api/types/common.ts` | add `'scene-tabs'` (A1) |
| `src/api/events.ts`, `src/api/types/api.ts` | add `'tabs-changed'` (A1) |
| `src/api/viewTracker.ts` | emit `tabs-changed` from `tabMetaStore` (A1) |
| `src/api/viewInfo.ts`, `src/api/types/views.ts` | `SceneSnapshot.tabId`; `ViewsApi.showTab?` (A1) |
| `src/api/views.ts` | `showTab` (A1) |
| `src/app/extensions/slots.ts` | `sceneTabMenuSlot` (A2) |
| `src/api/types/ui.ts`, `src/api/ui/index.ts` | `SceneTabMenuContext`, `SceneTabMenuSection`, `addSceneTabMenuSection?` (A2) |
| `src/app/extensions/menuEntries.ts` | section → entries, with a `label` row (A2) |
| `src/app/react/components/context-menu/AtlasContextMenu.tsx` | entry type `label`; root entries as a function plus `subscribe` (A2) |
| `src/app/react/root/ContextMenuContext.tsx` | `open()` accepts live entries (A2) |
| `src/app/react/tabPresenting.ts` | `openPresentMenu` → `openSceneTabMenu` (A2) |
| `src/app/react/components/SceneTabBar.tsx` | menu always offered; badge (A2, A3) |
| `src/app/services/presentationTargets.ts`, `src/api/types/presentation.ts`, `src/api/presentation.ts` | `tabBadge` (A3) |
| `src/app/react/components/scene-tab-bar.scss` | `.scene-tab__badge` (A3) |
| `docs/extension-api.md`, `api-report/atlas-vtt-api.d.ts`, `changelog/Unreleased.md` | each task adds its part; A4 finishes |

**Connect (Track B)**

| File | Change |
|---|---|
| `vendor/atlas/**` | re-vendor at `api-pr-16-end` (B1) |
| `tests/fake/fakeViews.ts`, `fakeUi.ts`, `fakePresentation.ts`, `FakeAtlas.ts`, `fakeAtlas.tabs.contract.test.ts` (new) | tabs, `showTab`, `tabs-changed`, the menu section, `tabBadge` (B1) |
| `src/app/online/protocol.ts`, `scene/sceneMessages.ts`, `scene/sceneValidation.ts`, `tools/toolMessages.ts` | `scene-state`; `DiceLogEntry.scene` (B2) |
| `src/app/online/split/tabKey.ts`, `split/SceneAssignments.ts`, `split/splitLimits.ts`, `split/splitCopy.ts` (all new) | the model (B3) |
| `src/app/online/atlas/tabScenes.ts` (new) | tabs, live attribution, `showTab` (B4) |
| `src/app/online/atlas/presentedSource.ts` | expose `presentedTab()` (B4) |
| `src/app/online/scene/SceneSlot.ts` (new), `scene/SceneHub.ts` (new), `scene/slotAudience.ts` (new), `scene/goLive.ts` (new) | the split of `SceneBroadcaster` (B5) |
| `src/app/online/scene/SceneBroadcaster.ts` | deleted; its tests move to `sceneHub*.test.ts` (B5) |
| `src/app/online/scene/CameraSender.ts` | per slot (B6) |
| `src/app/online/assets/AssetServer.ts` | per-player allow-set (B7) |
| `src/app/online/control/ControlLists.ts`, `TokenMoveHandler.ts` | per slot (B8) |
| `src/app/online/tools/LaserRelay.ts`, `tools/DiceHost.ts` | per slot (B9) |
| `src/app/online/PlayerSession.ts`, `playerSessionScene.ts`, `page/pageScreen.ts`, `page/diceLogModel.ts`, `online-client/main.mts`, `obsidian/remote/RemoteSceneClient.ts`, `obsidian/CanvasScene.ts`, `styles/…` | the paused banner and the dice label (B10) |
| `src/app/online/gm-ui/presentToRows.ts` (new), `PresentToButton.tsx` (new), `PresentToPopover.tsx` (new), `OnlinePresenting.tsx`, `OnlinePlayerList.tsx`, `online-panel.scss`, `onlinePalette.ts`, `src/app/online/onlineSessionStore.ts`, `OnlineSessionService.ts` | the panel (B11) |
| `src/app/online/gm-ui/sceneTabMenu.ts` (new), `tabBadge.ts` (new), `registerGmUi.ts`, `src/app/online/registerOnline.ts` | the eye menu and badge (B12) |
| `src/app/online/hostedSession.ts`, `sessionDeps.ts` | wiring (B5–B9) |
| `README.md`, `PRIVACY.md` | B13 |

---

## Track A: API batch 16 (API 1.17.0)

### Task A1: Version 1.17.0, `scene-tabs`, `tabs-changed`, `SceneSnapshot.tabId` and `views.showTab`

**Files:**
- Modify:
  - `src/api/version.ts`
  - `src/api/capabilities.ts`
  - `src/api/types/common.ts`
  - `src/api/events.ts`
  - `src/api/types/api.ts`
  - `src/api/viewTracker.ts`
  - `src/api/viewInfo.ts`
  - `src/api/types/views.ts`
  - `src/api/views.ts`
  - `docs/extension-api.md`: the table row, and the paragraphs for these three additions
  - `changelog/Unreleased.md`
- Test:
  - `tests/api/viewsTabs.test.ts` (new)
  - `tests/api/events.test.ts` (add cases)
  - `tests/api/versionCheck.test.ts` (unchanged, must pass)

**Interfaces:**
- Produces:
```ts
// types/views.ts
export interface SceneSnapshot { /* … */ readonly tabId?: string | null }
export interface ViewsApi { /* … */ showTab?(viewId: ViewId, tabId: string): Promise<boolean> }
// types/api.ts, the events map
'tabs-changed': (view: ViewInfo) => void;
```
- Rules:
  - `viewInfo.ts`:
    - `tabId` is the active tab's id when `atlasStore.mapLoaded && !isMapLoading && mapPath === activeTab.filePath`, and `null` otherwise;
    - it is `null` for a remote view;
    - `tabId` is added to `snapshotSlice`.
  - `viewTracker.ts`:
    - subscribes to each map view's `tabMetaStore`;
    - compares `tabs` (by `id`, `filePath`, `displayName`, order) and `activeTabId`;
    - queues one `tabs-changed` per view per microtask with `viewInfo(view)`;
    - never fires for a remote view;
    - stops on view close.
  - `views.ts`, `showTab`:
    - returns `false` at once for an unknown, closed or remote view or an unknown tab;
    - otherwise it bumps a per-view switch counter, awaits `view.switchToTab(tabId)` and then `whenMapLoaded(store)`;
    - it answers `true` only if the counter is unchanged and the store shows that tab (`showsTab`);
    - it never presents, and never throws for these cases.
  - The capability is attached only with `has('scene-tabs')`.

- [ ] **Step 1: Write the tests.**
  ```ts
  describe('views.showTab', () => {
    it('makes a background tab active without presenting it, and answers true once loaded', async () => {
      const { api, view } = harnessWithTabs(['a.atlasmap', 'b.atlasmap']);   // tests/api/fakeAtlasView.ts
      const presented = api.presentation.current();
      await expect(api.views.showTab!(view.viewId, view.tabIds[1])).resolves.toBe(true);
      expect(api.views.snapshot(view.viewId)!.tabId).toBe(view.tabIds[1]);
      expect(api.presentation.current()).toEqual(presented);
    });
    it('answers false when another switch overtakes it', async () => { /* two calls without awaiting: first false, second true */ });
    it('answers false for an unknown tab, a closed view and a remote view', async () => { /* … */ });
  });
  describe('SceneSnapshot.tabId', () => {
    it('is null while the next tab loads and its id once loaded', async () => { /* subscribe; record tabId per call: [a, null, b] */ });
  });
  describe('tabs-changed', () => {
    it('fires once per view when a background tab closes', async () => { /* removeTab on the inactive tab → one call, tabs without it */ });
    it('fires on rename, reorder and activeTabId, coalesced within a microtask', async () => { /* … */ });
    it('never fires for a remote view', () => { /* … */ });
  });
  ```
  These are contract cases `C-tabs-1`, `C-tabs-2` and `C-tabs-3`; put the id in each case's name. Run `npx vitest run tests/api/viewsTabs.test.ts`. Expected: FAIL.
- [ ] **Step 2: Implement.** Bump `API_VERSION` to `1.17.0` and add `'scene-tabs'` to both `AtlasCapability` and `LANDED_CAPABILITIES`. The `showTab` doc comment follows the spec's 9.1 text.
- [ ] **Step 3: Docs.**
  - Add the `docs/extension-api.md` row `| 1.17.0 | in progress | \`scene-tabs\` | \`views.showTab\`, \`ui.addSceneTabMenuSection\` (optional) | \`tabs-changed\` |`.
  - Add the "Version 1.17.0 adds …" paragraphs for `tabs-changed`, `tabId` and `showTab`.
  - Add these changelog lines under `## New`:
    ```markdown
    - Extension API: `tabs-changed` tells extensions when a map view's tabs or active tab change, a scene snapshot names its tab, and `views.showTab` opens a tab without presenting it (API 1.17.0, `scene-tabs`)
    ```
  - Run `npm run changelog:generate`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run the Atlas verify block (`API_BASE_REF=<B15>`).
- [ ] **Step 5: Commit** these files:
  - `src/api/version.ts`, `src/api/capabilities.ts`, `src/api/types/common.ts`
  - `src/api/events.ts`, `src/api/types/api.ts`
  - `src/api/viewTracker.ts`, `src/api/viewInfo.ts`, `src/api/types/views.ts`, `src/api/views.ts`
  - `docs/extension-api.md`, `api-report/atlas-vtt-api.d.ts`
  - `changelog/Unreleased.md`, `src/app/changelog/releases.json`
  - `tests/api/viewsTabs.test.ts`, `tests/api/events.test.ts`

  Use the message `feat(api): tabs-changed, snapshot tabId and views.showTab (API 1.17.0)`.

**Review Focus (A1):**
- `tabId` must never name a tab whose scene the store does not hold. Check the order inside `switchToTab`: `setActiveTab` runs before `performSceneLoad`, so `activeTabId` already names B while the store still holds A. The `mapPath === filePath` guard is what makes this safe; pin it with a case that reads the snapshot between the two.
- `showTab` must not leave the presented scene held forever. Holding is Atlas's normal behaviour on any switch; a resume happens when the GM returns.

### Task A2: The scene-tab eye menu slot, live top-level entries and the label row

**Files:**
- Modify:
  - `src/app/extensions/slots.ts`: `sceneTabMenuSlot: SlotRegistry<SceneTabMenuSection>`
  - `src/api/types/ui.ts`, `src/api/ui/index.ts`: `addSceneTabMenuSection?`, attached with `scene-tabs`
  - `src/app/extensions/menuEntries.ts`: `sceneTabMenuEntries(ctx): ContextMenuEntry[]`
  - `src/app/react/components/context-menu/AtlasContextMenu.tsx`:
    - a `{ type: 'label'; text: string }` entry, rendered as `DropdownMenu.Label`;
    - `renderEntries` accepts a function list
  - `src/app/react/root/ContextMenuContext.tsx`: `open(entries: ContextMenuEntry[] | (() => ContextMenuEntry[]), position, options?: ContextMenuOptions & { subscribe?: (onChange: () => void) => () => void })`
  - `src/app/react/tabPresenting.ts`: `openPresentMenu` → `openSceneTabMenu(app, view, tabId, position): boolean`
  - `src/app/react/components/SceneTabBar.tsx`: the eye's `onContextMenu` and its keyboard opener (ContextMenu key, Shift+F10) call `openSceneTabMenu`
  - `docs/extension-api.md`, `changelog/Unreleased.md`
- Test:
  - `tests/unit/sceneTabMenu.test.tsx` (new)
  - `tests/unit/tabPresenting.test.ts` (extend)
  - `tests/api/ui.test.ts` (add `C-tabmenu-1`)
  - `tests/unit/atlasContextMenu.items.test.tsx` (the label row)

**Interfaces:**
- Produces:
```ts
export interface SceneTabMenuContext { viewId: ViewId; tabId: string; mapPath: string; name: string; active: boolean; presented: boolean }
export interface SceneTabMenuSection { heading: string; items(context: SceneTabMenuContext): MenuItem[] }
// UiApi
addSceneTabMenuSection?(section: SceneTabMenuSection): Disposer;
// tabPresenting.ts
export function openSceneTabMenu(app: App, view: AtlasView, tabId: string, position: { x: number; y: number }): boolean;
```
- Rules:
  - The entry list is a function that rebuilds the following, in order:
    1. Atlas's "Open player window", while a target is active;
    2. for each section whose `items(ctx)` is not empty: a separator, `{ type: 'label', text: heading }`, then the converted items.
  - The menu opens only if the first build is not empty, and then returns true.
  - While it is open it subscribes to the UI slot version, so `ui.invalidate()` rebuilds it, and to the view's `tabMetaStore`, so `active` follows a switch.
  - `ctx` is rebuilt on each read.
  - A heading is trimmed and capped at 40 characters, and a section with an empty heading throws at `addSceneTabMenuSection`.
  - A throwing `items` drops that section and logs `[Atlas API] ui.addSceneTabMenuSection: …` once.
  - The root `keepOpen` behaviour is unchanged.

- [ ] **Step 1: Write the tests.**
  ```ts
  it('opens with an extension section while no target is active', () => { /* add section; openSceneTabMenu → true; label row + items rendered */ });
  it('does not open with nothing to show', () => { /* no target, no section → false (today's behaviour) */ });
  it('checkmarks follow invalidate in the top-level menu (C-tabmenu-1)', async () => {
    let on = false;
    addSection({ heading: 'Present to', items: () => [{ label: 'Anna', checked: on, keepOpen: true, onClick: () => { on = !on; api.ui.invalidate(); } }] });
    open(); await user.click(screen.getByRole('menuitemcheckbox', { name: 'Anna' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Anna' })).toHaveAttribute('aria-checked', 'true');
  });
  it('stays open while its tab becomes active', async () => { /* click item whose onClick calls view.switchToTab; menu still in the document; ctx.active true on reread */ });
  it('leaves a throwing section out and logs once', () => { /* … */ });
  it('passes name, mapPath, active and presented for the right-clicked tab', () => { /* … */ });
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement. Keep `AtlasContextMenu.tsx` under 300 lines: if it passes the cap, move `renderEntries` into `contextMenuEntries.tsx`. Run `grep -n "title=" src/app/react/components/context-menu src/app/react/components/SceneTabBar.tsx`. It must print nothing new.
- [ ] **Step 3: Docs.**
  - Add the "Version 1.17.0 also adds `ui.addSceneTabMenuSection(section)` …" paragraph.
  - Add the 1.13.0 note's successor: "From 1.17.0 the scene-tab menu's own items follow `ui.invalidate()` too."
  - Add this changelog line under `## New`:
    ```markdown
    - Extension API: `ui.addSceneTabMenuSection` adds a section to the menu that right-clicking a scene tab's eye opens; its checkmarks follow changes while it is open
    ```
- [ ] **Step 4:** Run the tests and the Atlas verify block.
- [ ] **Step 5:** Commit the files above with the message `feat(api): a menu section on the scene tab eye that stays current (API 1.17.0)`.

**Review Focus (A2):**
- The live root entries must not change menus that pass a plain array: the token, fog and "More options" menus. `contextMenuProvider.registry.test.tsx` and `atlasContextMenu.items.test.tsx` must pass unchanged.
- Radix focus must survive a rebuild. Keys are indexes today, so a rebuild with the same shape keeps focus. Pin "arrow keys still move after a rebuild".

### Task A3: `PresentationTarget.tabBadge` and the eye's marker

**Files:**
- Modify:
  - `src/api/types/presentation.ts`, `src/api/presentation.ts`: validate and wrap `tabBadge`
  - `src/app/services/presentationTargets.ts`: `PresentationTargetEntry.tabBadge?`, and `tabBadgeFor(viewId, tabId): string | null`
  - `src/app/react/components/SceneTabBar.tsx`: the badge span, the eye's "shown" class when a badge exists, and the `aria-label`
  - `src/app/react/components/scene-tab-bar.scss`: `.scene-tab__badge` (small, muted, `max-width: 24ch`, ellipsis)
  - `docs/extension-api.md`, `changelog/Unreleased.md`
- Test:
  - `tests/unit/sceneTabBar.badge.test.tsx` (new)
  - `tests/api/presentation.test.ts` (add `C-badge-1`)

**Interfaces:**
```ts
export interface PresentationTarget { id: string; label: string; isActive(): boolean; tabBadge?(tab: { viewId: ViewId; tabId: string }): string | null }
export function tabBadgeFor(viewId: string, tabId: string): string | null; // first active target's non-null badge; trimmed; > 24 chars cut with "…"; throw → null, logged once per target
```

- [ ] **Step 1: Write the tests.**
  ```ts
  it('shows the badge after the eye and draws the eye as shown on a tab that is not presented', () => { /* target.tabBadge returns '2 players' for tab b */ });
  it('names the badge in the eye\'s accessible name', () => { /* aria-label contains '2 players' */ });
  it('re-reads badges after invalidate', () => { /* … */ });
  it('a throwing or non-string badge shows nothing and logs once (C-badge-1)', () => { /* … */ });
  it('an inactive target\'s badge is ignored', () => { /* … */ });
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement. The existing `sceneTabBar.presented.test.tsx` and `sceneTabBar.target.test.tsx` must pass unchanged.
- [ ] **Step 3: Docs.** Add the "Version 1.17.0 also adds `PresentationTarget.tabBadge` …" paragraph, and this changelog line under `## New`:
  ```markdown
  - Extension API: a presentation target can mark scene tabs next to their eye, for example with how many players see them
  ```
- [ ] **Step 4:** Run the tests and the verify block. Commit with the message `feat(api): presentation targets can badge scene tabs (API 1.17.0)`.

**Review Focus (A3):** The badge must not change what a click on the eye does. Only the style and the accessible name change.

### Task A4: Finish batch 16: the reference section, contract ids and the tag

**Files:**
- Modify:
  - `docs/extension-api.md`:
    - the section ``## Scene tabs (`scene-tabs`, 1.17.0)``, with the spec's 9.2 behaviour in prose;
    - the table row's status set to "shipped in 1.17.0" when released;
    - the reference bullets for `views`, `ui` and `presentation`
  - `api-report/atlas-vtt-api.d.ts`: regenerate
- Test:
  - `tests/api/apiReport.test.ts`
  - `tests/api/viewsTabs.test.ts`
  - A grep that every contract id `C-tabs-1`, `C-tabs-2`, `C-tabs-3`, `C-tabmenu-1` and `C-badge-1` names a test.

- [ ] **Step 1:** Write the section. Every new member's JSDoc in the report must say "1.17.0" and the capability.
- [ ] **Step 2:** Run the verify block.
- [ ] **Step 3:** Commit `docs/extension-api.md` and `api-report/atlas-vtt-api.d.ts` with the message `docs(api): scene tabs reference (API 1.17.0)`. Tag `api-pr-16-end`, local only.

**Review Focus (A4):** `API_BASE_REF=<B15> npm run api:check` passes. The report diff has only additions, which proves this is a minor bump.

---

## Track B: Connect

### Task B1: Re-vendor at `api-pr-16-end`; FakeAtlas tabs, `showTab`, `tabs-changed`, the menu section and `tabBadge`

**Files:**
- Run: `node scripts/sync-atlas.mjs --atlas C:\Users\joaoo\2075\atlas-vtt-upstream-wt --commit <sha of api-pr-16-end>`
- Modify:
  - `tests/fake/fakeViews.ts`: per view `tabs`, `activeTabId`, `showTab`, `closeTab`, `renameTab`, `tabs-changed`; `snapshot.tabId` set only once a tab is loaded
  - `tests/fake/fakeUi.ts`: `addSceneTabMenuSection`, plus `openSceneTabMenu(viewId, tabId)` returning the current rows and re-reading on `invalidate`
  - `tests/fake/fakePresentation.ts`: keep `tabBadge` from `addTarget`; `badgeFor(viewId, tabId)`
  - `tests/fake/FakeAtlas.ts`: `scene-tabs` in `has()`, switchable off with `without('scene-tabs')`
- Create: `tests/fake/fakeAtlas.tabs.contract.test.ts`, running `C-tabs-1..3`, `C-tabmenu-1` and `C-badge-1` against the fake.

**Interfaces:**
- Produces, for tests: `fakeAtlas.views.addTab(viewId, mapPath, name): string`, `switchTab(viewId, tabId, { loadDelayMs? })`, `closeTab`, `renameTab`, and `fakeAtlas.ui.sceneTabMenu(viewId, tabId): MenuItem[]`.

- [ ] **Step 1:** Write the contract test file, with the same cases as A1–A3 against the fake. Run it. Expected: FAIL.
- [ ] **Step 2:** Sync the vendor and implement the fakes. `npm run check:vendor` must pass.
- [ ] **Step 3:** Run the Connect verify block. Commit `vendor/atlas` (created in full by the sync) and the five test files, with the message `chore: vendor Atlas API 1.17.0; FakeAtlas scene tabs` and the body `Vendor: api-pr-16-end (API 1.17.0).`.

**Review Focus (B1):** The fake must reproduce the A1 ordering, where `activeTabId` changes before the snapshot reloads. Otherwise B5's privacy test proves nothing.

### Task B2: Protocol: `scene-state` and `DiceLogEntry.scene`

**Files:**
- Modify:
  - `src/app/online/protocol.ts`: the `ControlMessage` union gains `SceneStateMessage`. Do not change `PROTOCOL_VERSION`.
  - `src/app/online/scene/sceneMessages.ts`: `sceneStateMessage(sceneId, paused)`
  - `src/app/online/scene/sceneValidation.ts`: `isSceneState`
  - `src/app/online/tools/toolMessages.ts`: `DiceLogEntry.scene?: string`, validated (`cleanSceneLabel`: trimmed, at most 64 characters, no control or bidi characters; dropped otherwise)
- Test:
  - `tests/unit/online/protocol.split.test.ts` (new)
  - `tests/unit/online/diceLogModel.test.ts` (add the label)

**Interfaces:**
```ts
/** Unsequenced, like scene-camera (D19): sent with session.send, never channels.sendSequenced. */
export interface SceneStateMessage { v: 1; type: 'scene-state'; sceneId: string; paused: boolean }
export function sceneStateMessage(sceneId: string, paused: boolean): SceneStateMessage;
export interface DiceLogEntry { /* … */ scene?: string }
```

- [ ] **Step 1: Write the tests.**
  ```ts
  it('decodes a well-formed scene-state', () => { /* … */ });
  it('rejects a scene-state with a long id or a non-boolean paused', () => { /* invalid, not message */ });
  it('an older decoder ignores scene-state and the dice scene', () => {
    // decodeControl from the v0.1 build's message set: build with a type list without 'scene-state' → kind 'ignored';
    // isDiceLogEntry on an entry with scene → true and the field unread
  });
  it('drops a dice scene label with control characters and keeps the roll', () => { /* … */ });
  it('PROTOCOL_VERSION is still 1', () => { expect(PROTOCOL_VERSION).toBe(1); });
  it('an older page\'s mirror sees snapshot, scene-state and patch and asks for no resync', () => {
    // Real PlayerSceneMirror. Feed snapshot (seq 1), then scene-state (decoded 'ignored' by the old type table, so
    // the mirror never sees it), then patch (seq 2) → sendResync is not called. This pins that scene-state takes no seq.
  });
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(protocol): scene-state and a scene label on dice entries, still v1`.

**Review Focus (B2):**
- The "older decoder" case must use the real `decodeControl` with the type table as it was before this task (copy the set into the test), not a mock.
- `scene-state` never takes a `seq`: `grep -n "scene-state" src/app/online/scene/PlayerChannels.ts` must print nothing.

### Task B3: The model: `TabKey`, `SceneAssignments` and the cap

**Files:**
- Create:
  - `src/app/online/split/tabKey.ts`
  - `src/app/online/split/SceneAssignments.ts`
  - `src/app/online/split/splitLimits.ts` (`SPLIT_LIMITS = { scenesInUse: 4, goLiveWaitMs: 2000 } as const`)
  - `src/app/online/split/splitCopy.ts` (every string of spec section 3, as constants or functions)
- Test:
  - `tests/unit/online/sceneAssignments.test.ts`
  - `tests/unit/online/splitCopy.test.ts`

**Interfaces:**
```ts
export interface TabKey { viewId: string; tabId: string }
export function tabKeyOf(tab: TabKey): string;
export function sameTab(a: TabKey | null, b: TabKey | null): boolean;
export type AssignResult = 'ok' | 'follows' | 'cap';
export class SceneAssignments {
  assign(playerId: string, tab: TabKey, presented: TabKey | null): AssignResult;
  unassign(playerId: string): void;
  clear(): string[];
  tabOf(playerId: string): TabKey | null;
  sceneOf(playerId: string, presented: TabKey | null): TabKey | null;
  dropTab(tab: TabKey): string[];
  dropView(viewId: string): string[];
  presentedChanged(presented: TabKey | null): string[];   // D15: players assigned to it become followers
  retainPlayers(known: ReadonlySet<string>): void;
  scenesInUse(presented: TabKey | null): TabKey[];
  wouldExceedCap(playerId: string, tab: TabKey, presented: TabKey | null): boolean;
  assignedCount(): number;
  onChange(listener: (playerIds: string[]) => void): () => void;
}
```
- `splitCopy.ts` holds:
  - `presentToLabel(names, total)`: "Present to: everyone", "Present to: Anna, Ben", "Present to: Anna, Ben and 3 more" or "Present to: nobody"
  - `PRESENT_TO_HEADING = 'Present to'`, `presentSceneToHeading(name)`
  - `rowLabel(...)`
  - `EVERYONE_BACK_LABEL = 'Everyone back to the presented scene'`
  - `EVERYONE_BACK_COMMAND = 'Bring all players back to the presented scene'`
  - `CAP_NOTE = 'At most 4 scenes at once'`, `capPanelNote()`
  - `splitStatus(n)`
  - `closedNotice(names, scene)`
  - `PAUSED_BANNER = "The GM is on another scene. You can't move tokens until they're back."`
  - `UPDATE_ATLAS_NOTE = 'Update Atlas VTT to show different scenes to different players.'`
  - `couldntOpen(scene)`
  - `badge(n)`: "1 player" or "3 players"

- [ ] **Step 1: Write the tests.**
  ```ts
  it('assigning to the presented tab stores nothing: the player follows', () => {});
  it('moving the last player of C to new D keeps the count and is allowed at the cap', () => {});
  it('refuses a fifth scene in use, the presented one counted', () => {});
  it('presenting a tab turns its assigned players into followers (D15)', () => {});
  it('a closed tab drops its assignments and returns who went back', () => {});
  it('keeps a disconnected player and drops a kicked one', () => {});
  it('clear returns every assigned player once and fires one change', () => {});
  // splitCopy
  it('writes every label in sentence case', () => { /* each string: first letter upper, rest of the words lower except names */ });
  it('Present to: Anna, Ben and 3 more', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement. The model is pure: no Atlas, no session.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): scene assignments, the cap and the split party wording`.

**Review Focus (B3):** `sceneOf` is the only resolver. B5–B9 must call it rather than re-derive it (no duplicated logic).

### Task B4: `TabScenes`, the GM's tabs and the live attribution

**Files:**
- Create: `src/app/online/atlas/tabScenes.ts`
- Modify:
  - `src/app/online/atlas/presentedSource.ts`: `presentedTab(): TabKey | null`, from `current()`
  - `src/app/online/atlas/sessionDeps.ts`: build `TabScenes` when `has('scene-tabs')`
- Test: `tests/unit/online/tabScenes.test.ts`

**Interfaces:**
```ts
export interface TabInfo extends TabKey { mapPath: string; name: string }
export interface TabScenes {
  tabs(): TabInfo[];                                    // GM map views only
  tab(key: TabKey): TabInfo | null;
  /** The tab whose scene this loaded snapshot holds, or null (P2: loaded && tabId). */
  liveTab(): TabKey | null;
  liveSnapshot(key: TabKey): SceneSnapshot | null;      // only when liveTab() is key
  subscribeLive(listener: (live: TabKey | null) => void): () => void;
  subscribeTabs(listener: (closed: TabKey[]) => void): () => void;  // from tabs-changed and map-closed
  show(key: TabKey): Promise<boolean>;                   // views.showTab
  dispose(): void;
}
export function createTabScenes(atlas: Pick<AtlasExtension, 'views' | 'on'>): TabScenes;
```
- `liveTab()` reads `views.snapshot(viewId)` for each GM map view. It is `{ viewId, tabId: snapshot.tabId }` only when `snapshot.loaded && typeof snapshot.tabId === 'string'`. **This file is the only Connect file that reads `activeTabId`, and only to fill `TabInfo`.**

- [ ] **Step 1: Write the tests.**
  ```ts
  it('names no live tab while the next tab loads, even though activeTabId already changed', () => {});
  it('reports the closed background tab from tabs-changed', () => {});
  it('reports every tab of a closed view', () => {});
  it('follows a rename without reporting a close', () => {});
  it('show answers false when overtaken', async () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): the GM's tabs and which one is live`.

**Review Focus (B4):** `liveTab` must not cache across a `views.subscribe` callback. Read the snapshot each time; it is a frozen object and costs nothing.

### Task B5: `SceneHub` and `SceneSlot`: one live projection, parked slots and audiences

This is the core task. It replaces `SceneBroadcaster.ts`, which is at the 300-line cap.

**Files:**
- Create:
  - `src/app/online/scene/SceneSlot.ts`: one scene's projection state. It holds what `SceneBroadcaster` holds today for one scene (`sceneId`, `lastSent`, `memo`, `SnapshotCache`, `MapSizeWait`, fog coverage while live), plus the kept snapshot and lighting frame.
  - `src/app/online/scene/SceneHub.ts`: the `SessionHandler`. It keeps slots by `tabKeyOf`, the presented slot, the routing, and the reassignment.
  - `src/app/online/scene/slotAudience.ts`: `audienceOf(slot, players, assignments, presented): string[]`.
  - `src/app/online/scene/goLive.ts`: the P8 wait. It resolves when lighting is `ready` or `unlit`, or after `SPLIT_LIMITS.goLiveWaitMs`.
- Delete: `src/app/online/scene/SceneBroadcaster.ts`.
- Modify:
  - `src/app/online/scene/sceneTicks.ts`: `SnapshotCache` per slot
  - `src/app/online/scene/LiveLighting.ts`: `lastFrame()` for parking
  - `src/app/online/scene/CameraSender.ts`: only the `CameraProjection` import becomes `SlotProjection` (B6 does the rest)
  - `src/app/online/hostedSession.ts`, `src/app/online/atlas/sessionDeps.ts`
- Test:
  - move `tests/unit/online/sceneBroadcaster.test.ts` to `sceneHub.test.ts`, changing only the constructor and imports;
  - new: `sceneHub.split.test.ts`, `sceneHub.privacy.test.ts`, `sceneHub.lighting.test.ts`, `sceneSlot.test.ts`.

**Interfaces:**
```ts
/** Replaces CameraProjection: what a player has, and every change of it. */
export interface SlotProjection {
  slotOf(playerId: string): SlotView | null;
  liveSlot(): SlotView | null;
  onSlotChange(listener: (change: SlotChange) => void): () => void;
}
export interface SlotView { tab: TabKey; sceneId: string; state: 'waiting' | 'live' | 'parked'; lastSent: PlayerScene | null; mapPath: string; name: string }
export type SlotChange =
  | { kind: 'projected'; slot: SlotView }                 // lastSent changed
  | { kind: 'state'; slot: SlotView }                     // live ↔ parked
  | { kind: 'moved'; playerId: string; from: SlotView | null; to: SlotView | null }
  | { kind: 'freed'; slot: SlotView };
export class SceneHub implements SessionHandler, SlotProjection {
  constructor(options: SceneHubOptions);  // SceneBroadcaster's options + { tabs: TabScenes | null; assignments: SceneAssignments }
  assign(playerId: string, tab: TabKey): Promise<AssignResult | 'couldnt-open'>;
  unassign(playerId: string): void;
  everyoneBack(): void;
  scenes(): SceneUse[];                    // for onlineSessionStore (B11)
  dispose(): void;
}
```
- **Behaviour (spec sections 4, 6 and 8):**
  - Only the slot equal to `tabs.liveTab()` is subscribed (`views.subscribe`) and has a `LiveLighting`. On a tick it projects once and sends one patch to its audience.
  - **Leaving live:**
    - keep `lastSent`, `snapshot` and `lighting.lastFrame()`;
    - dispose `LiveLighting` and the fog coverage;
    - send `scene-state paused` to the audience.
  - **Going live:**
    1. subscribe;
    2. `goLive` (P8), sending nothing meanwhile;
    3. project with the kept memo;
    4. if `sceneId` is unchanged and `lastSent` exists, `diffScenes` → patch, otherwise a snapshot;
    5. then `scene-state` with `paused: false`.
  - **Reassignment (`moved`):** `scene-clear`, then the target slot's cached snapshot, then `scene-state` when that slot is parked. Camera and control come from B6 and B8 through `onSlotChange`.
  - **A never-live slot:** state `waiting`, its audience gets `scene-clear`, and `tabs.show(tab)` runs. On false the hub undoes the assignment and reports `'couldnt-open'`.
  - **A rules or settings change:** the live slot ticks. Each parked slot re-projects from its kept snapshot and frame (rebuilding its fog coverage, then dropping it) and patches its audience (D8).
  - **Presentation:**
    - `presented` (new) → a new presented slot (new `sceneId`), followers moved (clear plus snapshot when it is loaded, exactly as today's `showScene`), `assignments.presentedChanged`;
    - `held` → that slot parks;
    - `cleared` → followers get `scene-clear` and the slot is freed unless players are assigned to its tab.
  - **Closed tabs** (`subscribeTabs`): `assignments.dropTab`, the players are moved, the slot is freed, and the GM gets `closedNotice`.
  - **Without `tabs`** (no `scene-tabs`): the hub has the presented slot only. It is attributed as today (by presentation and `loaded`), and `assign` throws.

- [ ] **Step 1: Move the old suite.** Move `sceneBroadcaster.test.ts` to `sceneHub.test.ts`. The constructor gains `tabs` and `assignments`; nothing else changes.
  - Allowed changes, and only these:
    - "keeps sending the held scene while the GM browses another tab" now also expects one `scene-state paused`;
    - the resume case expects a patch (rename it "a held scene resumes with a patch, not a snapshot").
  - Add the recorded-stream case "with no assignments every player gets exactly what SceneBroadcaster sent":
    1. Before deleting `SceneBroadcaster`, record its output over the three `sceneSyncEndToEnd` flows into `tests/unit/online/fixtures/broadcasterStream.json`, one stream per flow.
    2. Flows 1 ("edits, fog and view rules", all live) and 3 ("never sends secrets") must be **equal**, message for message.
    3. Flow 2 ("holds and resumes …") may differ only as the test lists:
       - one unsequenced `scene-state` on hold and one on resume;
       - the resume's `scene-snapshot` and its parts replaced by at most one `scene-patch`, whose application gives the recorded scene;
       - the later `seq` numbers shifted to match.
    4. Any other difference fails.
- [ ] **Step 2: Write the new suites.**
  ```ts
  // sceneHub.split.test.ts
  it('a player assigned to B gets a clear, then B\'s snapshot, and nothing of A after it', () => {});
  it('only the live slot is projected per tick, whatever the number of parked slots', () => { /* spy projectForPlayers: one call per tick with 3 parked slots */ });
  it('a parked slot\'s players get scene-state paused and no patches', () => {});
  it('a returning player gets their slot\'s cached snapshot, not the presented scene', () => {});
  it('presenting B turns players assigned to B into followers of the new presentation', () => {});
  it('a tab closed under its players sends them to the presented scene and tells the GM', () => {});
  it('a never-live tab switches the GM view and its players wait until it loads', async () => {});
  it('showTab false undoes the assignment and reports couldnt-open', async () => {});
  it('a rules change re-projects parked slots and patches only their players (D8)', () => {});
  it('drops the fog coverage of a parked slot', () => { /* FogCoverageCache size 0 for parked */ });
  // sceneHub.privacy.test.ts
  it('during a switch from A to B nothing derived from A reaches B\'s players', () => {
    // fake: A live with token a1; switchTab(B, { loadDelayMs: 50 }); during the delay, mutate A's store → no message to B's audience;
    // after B loads, B's audience messages contain no id of A; A's audience got only scene-state paused.
  });
  it('a snapshot without tabId is attributed to no slot', () => {});
  // sceneHub.lighting.test.ts
  it('going live on a lit scene keeps the parked projection until sight is ready, then patches', () => {});
  it('still pending after 2 s projects closed (P8)', () => { /* fake timers */ });
  it('an unlit scene goes live at once', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Each new file stays at or under 300 lines. `SceneHub.ts` delegates projection to `SceneSlot` and routing to `slotAudience`. Run `grep -rn "SceneBroadcaster" src tests`. It may match only the recorded fixture's name.
- [ ] **Step 4:** Run the verify block, including every suite of the Opt-in guard.
- [ ] **Step 5:** Commit with the message `feat(split): one live projection and parked scenes, each with its own players`. Stage the new files, the deletion and the moved tests by name.

**Review Focus (B5):**
- Look for any send path that uses `channels.admitted()` instead of an audience. `grep -n "admitted()" src/app/online/scene` may only match `slotAudience.ts`.
- The memo must be per slot. A shared memo would hand records of A to B's projection as "unchanged".

### Task B6: Camera per slot

**Files:**
- Modify: `src/app/online/scene/CameraSender.ts`, which takes `SlotProjection` and `TabScenes`.
- Test:
  - `tests/unit/online/cameraSender.test.ts` (unchanged)
  - `tests/unit/online/cameraSender.split.test.ts` (new)

**Interfaces:**
- `new CameraSender({ session, presented, projection: SlotProjection, tabs: TabScenes | null })`.
- The GM camera (`views.watchCamera(viewId)`) is sent only while `tabs.liveTab()` equals the live slot's tab, and only to that slot's audience.
- Each slot keeps its last camera. On `moved`, the player gets the target slot's last camera after its snapshot.

- [ ] **Step 1: Write the tests.**
  ```ts
  it('sends the GM camera to the live slot\'s players only', () => {});
  it('a camera from the loading tab is sent to nobody', () => {});
  it('a moved player gets the target scene\'s last camera after its snapshot', () => {});
  it('a parked slot sends no camera', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): the GM camera reaches only the live scene's players`.

**Review Focus (B6):** The sequence: snapshot before camera, as `announce` does today. A camera ahead of its snapshot is dropped by players (a `sceneId` mismatch) and lost.

### Task B7: Assets per player

**Files:**
- Modify: `src/app/online/assets/AssetServer.ts`, which takes `SlotProjection`.
- Test:
  - `tests/unit/online/assetServer.test.ts` (unchanged)
  - `tests/unit/online/assetServer.split.test.ts` (new)

**Interfaces:**
- `allowedFor(playerId): ReadonlySet<string>` = `sceneAssetIds(slotOf(playerId)?.lastSent ?? null)`, cached per slot and recomputed on `projected`.
- On `moved` or `projected`, cancel that player's transfers outside their set, as `projectionChanged` does for everyone today.

- [ ] **Step 1: Write the tests.**
  ```ts
  it('a player on A is denied an image only B uses', () => {});
  it('moving a player cancels their in-flight transfer of an image the new scene lacks', () => {});
  it('an image both scenes use keeps streaming across the move', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): players fetch only their own scene's images`.

**Review Focus (B7):** A request racing a move must be checked when it arrives *and* when its first chunk is sent.

### Task B8: Token control and moves per slot

**Files:**
- Modify:
  - `src/app/online/control/ControlLists.ts`:
    - **while `assignments.assignedCount() > 0`:** `tokenIds = control.tokensOf(playerId) ∩ keys(slotOf(playerId).lastSent.tokens)`, re-sent on `moved` and when that set changes on `projected`;
    - with no assignment: today's list on today's triggers (D18);
    - when the last assignment goes: today's list, sent once to everyone.
  - `src/app/online/control/TokenMoveHandler.ts`: the checks run against **the sender's** slot. It must be live, `move.sceneId === slot.sceneId`, and `tabs.liveTab()` must equal `slot.tab`. Then it calls `tokens.move(slot.tab.viewId, …)`. A parked slot gets `token-move-refused`.
  - `src/app/online/control/deletedTokens.ts`: watch the live slot's map
  - `src/app/online/gm-ui/controlledByMenu.ts`: unchanged; it is GM-side and lists every player
- Test:
  - `tests/unit/online/controlLists.test.ts`, `tokenMoveHandler.test.ts` (unchanged)
  - new: `controlLists.split.test.ts`, `tokenMoveHandler.split.test.ts`

- [ ] **Step 1: Write the tests.**
  ```ts
  it('lists only the player\'s tokens in their own scene while split', () => {});
  it('without a split sends today\'s list and nothing on a fog reveal', () => {});
  it('a move resends the list for the new scene', () => {});
  it('refuses a move on a parked scene and writes nothing', () => {});
  it('refuses a move whose sceneId is another slot\'s', () => {});
  it('a move on the live slot lands through tokens.move on that slot\'s view', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): token control and moves follow each player's scene`.

**Review Focus (B8):** A move from a player on the live slot must not land if the GM switched tabs between the check and `tokens.move`. Re-read `liveTab()` immediately before the call.

### Task B9: Lasers and dice per slot

**Files:**
- Modify:
  - `src/app/online/tools/LaserRelay.ts`:
    - a player's laser is accepted only if `sceneId === slotOf(sender).sceneId`;
    - it is relayed to that slot's audience except the sender;
    - it is shown in the GM view only when that slot is live;
    - the GM's `lasers.onLocal` feeds only the live slot's audience, and only while `liveTab()` matches.
  - `src/app/online/tools/DiceHost.ts`:
    - a player roll uses `slotOf(player).mapPath`;
    - each recipient's entry is built per recipient: `name` keeps a token's name only if the token is in the recipient's slot `lastSent`, otherwise "GM";
    - `scene` is the roller's slot name while `scenesInUse > 1`;
    - GM rolls carry no `scene`.
- Test:
  - `laserRelay.test.ts`, `diceHost.test.ts` (unchanged)
  - new: `laserRelay.split.test.ts`, `diceHost.split.test.ts`

- [ ] **Step 1: Write the tests.**
  ```ts
  it('relays a laser only to players on the same scene', () => {});
  it('drops a laser stamped with another scene\'s id', () => {});
  it('the GM\'s laser during a switch reaches neither audience', () => {});
  it('a player roll uses their own scene\'s rules', () => {});
  it('a roll named after a token on B reads GM for players on A', () => {});
  it('labels player rolls with the roller\'s scene only while more than one scene is in use (D7)', () => {});
  it('replays the shared log to a returning player with names worked out for their scene', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): lasers stay in their scene; one dice log labelled by scene`.

**Review Focus (B9):** The replay of the last 50 entries on admission must use the per-recipient builder too. Otherwise a returning player gets token names from another scene.

### Task B10: Players: the paused banner and the dice label

**Files:**
- Modify:
  - `src/app/online/PlayerSession.ts` (an `onSceneState` callback), `src/app/online/playerSessionScene.ts`: `PlayerSceneInbox.paused`, reset on a new `sceneId`
  - `src/app/online/page/pageScreen.ts` and `online-client/main.mts`: the banner `PAUSED_BANNER` over the map, with `role="status"`
  - `src/app/online/page/diceLogModel.ts` and the page's log view: "Anna · Cave"
  - `src/app/online/obsidian/remote/RemoteSceneClient.ts`: `RemoteStatus` text when paused, through the existing status bar
  - `src/app/online/obsidian/CanvasScene.ts`: the banner in the Canvas tab
  - the page SCSS
- Test:
  - `tests/unit/online/playerSessionScene.test.ts`, `pageScreen.test.ts`, `diceLogView.test.ts` (add cases)
  - `tests/unit/online/obsidian/remoteSceneClient.test.ts` (add a case)

- [ ] **Step 1: Write the tests.**
  ```ts
  it('shows the paused banner for the shown scene and hides it when live again', () => {});
  it('ignores a scene-state for another sceneId', () => {});
  it('a new scene clears the banner', () => {});
  it('shows Anna · Cave in the log and no label without a scene', () => {});
  it('the remote view status says the scene is paused', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement. The banner sits in the page's existing status overlay; it adds no new layout.
- [ ] **Step 3:** Run the verify block and `npm run build:page`. Commit with the message `feat(split): players see when their scene is paused, and the scene of each roll`.

**Review Focus (B10):** On the page, a refused move while paused must not show the generic refusal toast on top of the banner. Suppress it while `paused`.

### Task B11: The GM panel: "Present to:", the popover, the status and "Everyone back"

**Files:**
- Create:
  - `src/app/online/gm-ui/presentToRows.ts`: the pure row builder of spec 3.4, shared with B12
  - `src/app/online/gm-ui/PresentToButton.tsx`
  - `src/app/online/gm-ui/PresentToPopover.tsx`
- Modify:
  - `src/app/online/gm-ui/OnlinePresenting.tsx`: the status line, the button, "Everyone back", the cap note and the update note
  - `src/app/online/gm-ui/OnlinePlayerList.tsx`: the "On {scene}" chip
  - `src/app/online/gm-ui/online-panel.scss`
  - `src/app/online/gm-ui/onlinePalette.ts` and `registerGmUi.ts`: the command `EVERYONE_BACK_COMMAND`
  - `src/app/online/onlineSessionStore.ts`: `scenes`, `assignedCount`, `split: 'on' | 'unsupported'`
  - `src/app/online/OnlineSessionService.ts`: `assign`, `unassign` and `everyoneBack` pass through to the hub, and the store is written on `onSlotChange`
- Test:
  - `tests/unit/online/presentToRows.test.ts`
  - `tests/unit/onlinePanel.split.test.tsx`

**Interfaces:**
```ts
export interface PresentToRow { playerId: string; label: string; checked: boolean; disabled: boolean; choose(): void }
export interface PresentToMenu { heading: string; rows: PresentToRow[]; capNote: string | null; everyoneBack: { label: string; disabled: boolean; choose(): void } }
export function presentToMenu(tab: TabInfo, state: OnlineSessionState, actions: SplitActions, headingKind: 'section' | 'panel'): PresentToMenu;
```

- [ ] **Step 1: Write the tests.**
  ```ts
  // presentToRows.test.ts: one case per row of the spec's 3.4 table, plus:
  it('a follower on the presented tab is checked and disabled (D16)', () => {});
  it('rows that would open a fifth scene are disabled and the heading notes the cap', () => {});
  it('everyone back is disabled with nothing assigned or nothing presented (D9)', () => {});
  // onlinePanel.split.test.tsx
  it('Present to: everyone when nobody is split', () => {});
  it('opens on hover after 300 ms and closes after the pointer leaves', () => { /* fake timers */ });
  it('stays open while ticking several players', async () => {});
  it('Escape closes and returns focus to the button', async () => {});
  it('shows 2 players are on other scenes and the Everyone back button', () => {});
  it('without scene-tabs shows the update note and no Present to button', () => {});
  it('disabled and reads Present to: no scene open without a map view', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement. Strings come only from `splitCopy.ts`. There are no `title` attributes: the popover rows are `<label><input type="checkbox">`.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): Present to in the online panel, and everyone back`.

**Review Focus (B11):** Hover-open must not fight click-open. Pin "a click while hover-opened keeps it open".

### Task B12: The eye's "Present to" section and the tab badge

**Files:**
- Create:
  - `src/app/online/gm-ui/sceneTabMenu.ts`: `presentToSection(deps): SceneTabMenuSection`. Its `items(ctx)` maps `presentToMenu(..., 'section')` to `MenuItem[]` (`checked`, `disabled`, `keepOpen: true`). "Everyone back" is a plain item without `keepOpen`.
  - `src/app/online/gm-ui/tabBadge.ts`: `tabBadge(state)(tab) → badge(n) | null`, only while `assignedCount > 0`
- Modify:
  - `src/app/online/gm-ui/registerGmUi.ts`: `ui.addSceneTabMenuSection?.(presentToSection(...))` while hosting; `ui.invalidate()` on `onSlotChange` and on presence (the existing invalidation hook)
  - `src/app/online/registerOnline.ts`: `ONLINE_TARGET` gains `tabBadge`
- Test: `tests/unit/online/sceneTabMenu.test.ts`, `tests/unit/online/tabBadge.test.ts`

- [ ] **Step 1: Write the tests.**
  ```ts
  it('adds the section only while hosting', () => {});
  it('lists players for the right-clicked tab with the 3.4 labels', () => { /* fakeAtlas.ui.sceneTabMenu(view, tabB) */ });
  it('ticking on a never-live tab switches the GM view and the row turns checked after invalidate', async () => {});
  it('badges every tab with players while split and none otherwise', () => {});
  it('the presented tab\'s badge counts its followers', () => {});
  ```
  Run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the verify block. Commit with the message `feat(split): Present to on the scene tab eye, and a badge per tab`.

**Review Focus (B12):** The section must be removed when hosting stops. Disposers go through the existing hosting lifetime, so a stopped session leaves no section and no badges (`C-life` style).

### Task B13: End-to-end privacy, the manual check, and docs

**Files:**
- Create: `tests/unit/online/splitPartyEndToEnd.test.ts`. It uses `MemoryNetwork`, three players and FakeAtlas with three tabs.
- Modify:
  - `README.md`: a section "Split party", covering the two ways to assign, Everyone back, the cap, and the fact that parked scenes are paused
  - `PRIVACY.md`: the scene name in the dice log (P9); everything else stays per scene

- [ ] **Step 1: Write the test.**
  ```ts
  it('no byte of B reaches a player on A', async () => {
    // Anna on A (presented), Ben assigned to B, Cy to C. Script: GM edits on A, switches to B, edits, moves Ben's token,
    // lasers, rolls, reveals fog on B, switches to C, closes B.
    // Capture every frame each player link receives (control + assets).
    // Assert: Anna's frames contain no record id, asset id, token name or sceneId of B or C; Ben's none of A or C until
    // B closes, after which Ben's first frame is scene-clear, then A's snapshot.
  });
  it('a reconnecting player lands on their assigned scene', async () => {});
  it('everyone back sends every player A\'s snapshot after a clear', async () => {});
  ```
  Run it. Expected: PASS. This task adds no new code; a failure is fixed in the owning task's files.
- [ ] **Step 2: Manual check (record it in the report).** Use Atlas at `api-pr-16-end` and Connect `dist/` copied by hand, with two browser pages and one Obsidian player.
  1. Open three tabs, one of them lit.
  2. Present A, then assign one page to B from the eye menu. The GM view switches to B.
  3. Tick several players in a row; the checkmarks follow.
  4. Switch back to A. B's player sees the paused banner, and a drag snaps back.
  5. Switch to B. There is no darkness flash and the token moves land.
  6. Roll on B. A's player sees "Ben · B".
  7. Close B. Ben is on A, and the GM sees the notice.
  8. Choose "Everyone back".
  9. Reload a page. It comes back to its assigned scene.
  10. Use an older page build (`dist-page` from 0.1.0-beta.2). It works, without the banner.
- [ ] **Step 3:** Run the verify block. Commit with the message `test(split): end-to-end privacy of a split party; docs`.

**Review Focus (B13):** The capture must include the asset channel, not only control messages.

---

## Task order and dependencies

```
A1 → A2 → A3 → A4 (tag api-pr-16-end)
                    └→ B1 → B2 → B3 → B4 → B5 → { B6, B7, B8, B9 } → B10 → B11 → B12 → B13
```

- B2 and B3 are pure and may start right after B1.
- B6–B9 depend only on B5's `SlotProjection` and may run in parallel. Each touches its own files.
- B10 needs B2. B11 and B12 need B5's `scenes()` and B3's copy.

**Task count:** 17 (A: 4, B: 13).
