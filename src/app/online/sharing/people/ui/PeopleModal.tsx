import React from 'react';
import { Modal, type App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../../../ui/nativeModal';
import { confirmAction } from '../../../../ui/confirmDialog';
import { PEOPLE_LABEL } from '../../../ui/onlineCopy';
import type { PeopleBook } from '../PeopleBook';
import { PeopleList } from './PeopleList';

/** The People dialog: Atlas's native modal with the people list. */
export class PeopleModal extends Modal {
  private root: Root | null = null;

  constructor(app: App, private readonly people: PeopleBook, private readonly ownTableId: string | null) {
    super(app);
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES, 'atlas-people-modal');
  }

  onOpen(): void {
    this.setTitle(PEOPLE_LABEL);
    this.root = createRoot(this.contentEl);
    void this.people.ready().then(() => {
      this.root?.render(
        <PeopleList
          people={this.people}
          ownTableId={this.ownTableId}
          confirmRemove={(who) => confirmAction({
            title: `Remove ${who.name}?`,
            message: [who.placeholder
              ? 'Notes and shares that name them reach nobody, and nobody else can take the name.'
              : 'They join as new next time, and what you share with them by name stops reaching them.'],
            confirmLabel: 'Remove', destructive: true,
          })}
        />,
      );
    });
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

/** Opens the People dialog on `people`; `ownTableId` (this Atlas's table, from the settings) heads its own group. */
export function openPeopleModal(app: App, people: PeopleBook, ownTableId: string | null): void {
  new PeopleModal(app, people, ownTableId).open();
}
