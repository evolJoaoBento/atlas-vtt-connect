/**
 * A section Connect adds to Atlas's Edit Token dialog, as plain data the host draws: a table of rows, each a label and
 * one choice per column. What the GM picks is applied only when the dialog saves, so Cancel leaves everything as it was.
 * Atlas's API has no such slot; a stock Atlas's (`stockUi`) draws it by placing it into the dialog.
 */
import type { Disposer, TokenMenuContext } from '@atlas-vtt/api-types';

export interface EditTokenChoice {
  /** Its key in what `save` receives. */
  id: string;
  /** Read out for the choice, as its column says it on screen. */
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
}

export interface EditTokenRow {
  label: string;
  choices: readonly EditTokenChoice[];
}

export interface EditTokenSectionSpec {
  title: string;
  /** The heading over each column of choices. */
  columns: readonly string[];
  rows: readonly EditTokenRow[];
  /** Called once when the dialog saves, with the value of every choice by id. */
  save(values: ReadonlyMap<string, string>): void;
}

/** The section for a token, or null for none (a plain token, a remote view). */
export type EditTokenSectionProvider = (ctx: TokenMenuContext) => EditTokenSectionSpec | null;

export interface EditTokenSectionsApi {
  addEditTokenSection(provider: EditTokenSectionProvider): Disposer;
}

/** Whether a `ui` namespace can add Edit Token sections: a stock Atlas's, drawn by Connect. */
export function hasEditTokenSections<T extends object>(ui: T): ui is T & EditTokenSectionsApi {
  return 'addEditTokenSection' in ui && typeof ui.addEditTokenSection === 'function';
}
