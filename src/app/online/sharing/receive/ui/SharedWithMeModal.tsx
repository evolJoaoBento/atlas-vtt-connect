import React from 'react';
import { Modal, Notice, type App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from 'zustand';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../../../ui/nativeModal';
import { dismissPush, NO_SHARE_SESSION_TEXT, shareSessionStore } from '../../shareSessionStore';
import type { SharedWithMe } from '../SharedWithMe';
import { SharedWithMeList } from './SharedWithMeList';

export const SHARED_WITH_ME_LABEL = 'Shared with me';

function Live({ service, onPulled, onProblem }: { service: SharedWithMe; onPulled: (path: string) => void; onProblem: (text: string) => void }): React.ReactElement {
  const people = useStore(shareSessionStore, (state) => state.people);
  const pushes = useStore(shareSessionStore, (state) => state.pushes);
  return <SharedWithMeList service={service} people={people} pushes={pushes} dismissPush={(push) => dismissPush(push.from, push.item)} onPulled={onPulled} onProblem={onProblem} />;
}

class SharedWithMeModal extends Modal {
  private root: Root | null = null;

  constructor(app: App, private readonly service: SharedWithMe) {
    super(app);
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES, 'atlas-shared-modal');
  }

  onOpen(): void {
    this.setTitle(SHARED_WITH_ME_LABEL);
    this.root = createRoot(this.contentEl);
    this.root.render(<Live service={this.service} onPulled={(path) => new Notice(`Pulled into ${path}`)} onProblem={(text) => new Notice(text)} />);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

/** Opens Shared with me for the current share session; outside one it says how to get one. */
export function openSharedWithMeModal(app: App, service: SharedWithMe | null): void {
  if (!service) {
    new Notice(NO_SHARE_SESSION_TEXT);
    return;
  }
  new SharedWithMeModal(app, service).open();
}
