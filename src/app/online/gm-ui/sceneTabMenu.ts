/**
 * The "Present to" section of the menu that right-clicking a scene tab's eye opens (spec 3.3, Atlas API 1.17.0
 * `ui.addSceneTabMenuSection`): the rows of `presentToRows` for that tab, as top-level checkable items that keep the
 * menu open, so the GM ticks several in a row. Atlas reads them again after `ui.invalidate()`, which Connect calls on
 * every change of the session store, so the checkmarks follow.
 */
import type { MenuItem, PresentationApi, SceneTabMenuSection, ViewsApi } from '@atlas-vtt/api-types';
import { onlineSessionStore } from '../onlineSessionStore';
import { NO_PLAYERS_ROW, PRESENT_TO_HEADING } from '../split/splitCopy';
import { tabNameIn } from './presentingHere';
import { presentToMenu, splitShown, splitViewOf, type SplitActions } from './presentToRows';

export interface PresentToSectionDeps {
  actions: SplitActions;
  presentation: Pick<PresentationApi, 'current'>;
  views: Pick<ViewsApi, 'list'>;
}

/** The section; empty (so left out) while not hosting or on an Atlas whose split party is off. */
export function presentToSection(deps: PresentToSectionDeps): SceneTabMenuSection {
  return {
    // Atlas reads the heading once; the cap note is therefore a disabled first row (spec 3.4 puts it in the heading).
    heading: PRESENT_TO_HEADING,
    items: (ctx): MenuItem[] => {
      const state = onlineSessionStore.getState();
      if (!splitShown(state)) return [];
      const view = splitViewOf(state, deps.presentation, (tab) => tabNameIn(deps.views, tab));
      const menu = presentToMenu({ viewId: ctx.viewId, tabId: ctx.tabId, name: ctx.name }, view, deps.actions, 'section');
      const rows: MenuItem[] = menu.rows.length === 0
        ? [{ label: NO_PLAYERS_ROW, disabled: true }]
        : menu.rows.map((row) => ({ label: row.label, checked: row.checked, disabled: row.disabled, keepOpen: true, onClick: () => row.choose() }));
      return [
        ...(menu.capNote ? [{ label: menu.capNote, disabled: true }] : []),
        ...rows,
        { label: menu.everyoneBack.label, disabled: menu.everyoneBack.disabled, onClick: () => menu.everyoneBack.choose() },
      ];
    },
  };
}
