/** The update choice and the merge page as native Atlas modals; each resolves once, with null when closed without an answer. */
import React from 'react';
import { Modal, type App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { confirmAction } from '../../../../ui/confirmDialog';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../../../ui/nativeModal';
import type { UpdateContext } from '../../receive/notePull';
import type { AskResult, MergeAnswer, MergeRequest } from '../noteUpdate';
import { MergeView } from './MergeView';
import { UpdateChoiceForm } from './UpdateChoiceForm';

class AnswerModal<T> extends Modal {
  private root: Root | null = null;
  private answered = false;
  private dirty = false;
  private asking = false;

  constructor(app: App, private readonly heading: string, cls: string, private readonly content: (answer: (value: T | null) => void, setDirty: (dirty: boolean) => void) => React.ReactElement,
    private readonly resolve: (value: T | null) => void) {
    super(app);
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES, cls);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    this.root = createRoot(this.contentEl);
    this.root.render(this.content((value) => {
      this.answered = true;
      this.resolve(value);
      this.close();
    }, (dirty) => { this.dirty = dirty; }));
  }

  /** Closing (Escape, the close button) after typing in the result asks first; answering never does. */
  close(): void {
    if (this.answered || !this.dirty) {
      super.close();
      return;
    }
    if (this.asking) return;
    this.asking = true;
    void confirmAction({
      title: 'Close without saving?',
      message: ['You edited the result. Closing now discards your edits and changes nothing in the note.'],
      confirmLabel: 'Close', destructive: true,
    }).then((yes) => {
      this.asking = false;
      if (yes) super.close();
    });
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    if (!this.answered) this.resolve(null);
  }
}

export function askUpdateChoice(app: App, context: UpdateContext): Promise<AskResult | null> {
  return new Promise((resolve) => {
    new AnswerModal<AskResult>(app, 'Shared note changed', 'atlas-merge-choice-modal',
      (answer) => <UpdateChoiceForm title={context.title} personName={context.personName} onAnswer={answer} />, resolve).open();
  });
}

export function openMergePage(app: App, request: MergeRequest): Promise<MergeAnswer | null> {
  return new Promise((resolve) => {
    new AnswerModal<MergeAnswer>(app, `Merge · ${request.context.title}`, 'atlas-merge-modal',
      (answer, setDirty) => (
        <MergeView onEdited={setDirty} chunks={request.chunks} preview={request.preview} conflictDefault={request.conflictDefault}
          onSave={answer} onCancel={() => answer(null)} />
      ), resolve).open();
  });
}
