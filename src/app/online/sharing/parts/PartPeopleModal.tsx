/**
 * The people for Share part: Only… or Except…: the people in the current session, or the people list when
 * there is none (labelled so), with tick boxes and Apply. Names come from the people list (`partPeople.ts`);
 * someone it cannot name, or a name a tag cannot hold, is shown but cannot be ticked.
 */
import React, { useState } from 'react';
import { Modal, type App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { Button } from '../../../ui/primitives/Button';
import { LabelTooltip } from '../../../ui/primitives/LabelTooltip';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../../ui/nativeModal';
import { LabelledCheck } from '../ui/LabelledCheck';
import { NOT_MET_EXCEPT_TEXT, NOT_MET_TEXT } from '../people/ui/peopleCopy';
import type { PartPeopleChoice } from './partPeople';

export type PartPeopleKind = 'only' | 'except';

const TITLES: Record<PartPeopleKind, string> = {
  only: 'Share selection only with',
  except: 'Share selection with everyone except',
};

interface PartPeopleFormProps {
  choice: PartPeopleChoice;
  kind?: PartPeopleKind;
  onApply: (names: string[]) => void;
  onCancel: () => void;
}

export function PartPeopleForm({ choice, kind, onApply, onCancel }: PartPeopleFormProps): React.ReactElement {
  const [ticked, setTicked] = useState<string[]>([]);
  const toggle = (name: string): void => setTicked(ticked.includes(name) ? ticked.filter((other) => other !== name) : [...ticked, name]);
  return (
    <div className="atlas-share">
      <section className="atlas-share__section">
        <h3 className="atlas-share__heading">{choice.inSession ? 'People in this session' : 'Not in a session: your people list'}</h3>
        {choice.people.length === 0 && <p className="atlas-share__hint">Nobody yet. Add people by name in People…, or they are added when you share a session with them.</p>}
        <ul className="atlas-share__people">
          {choice.people.map(({ name, problem, notMet }) => (
            <li key={name}>
              {problem === undefined
                ? (
                  <span className="atlas-share__person">
                    <LabelledCheck label={name} checked={ticked.includes(name)} onChange={() => toggle(name)} />
                    {notMet && <span className="atlas-share__not-met">{kind === 'except' ? NOT_MET_EXCEPT_TEXT : NOT_MET_TEXT}</span>}
                  </span>
                )
                : (
                  <LabelTooltip label={problem} multiline>
                    <span><LabelledCheck label={name} checked={false} disabled onChange={() => undefined} /></span>
                  </LabelTooltip>
                )}
            </li>
          ))}
        </ul>
      </section>
      <div className="modal-button-container">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="cta" disabled={ticked.length === 0} onClick={() => onApply(choice.people.filter((person) => person.problem === undefined && ticked.includes(person.name)).map((person) => person.name))}>Apply</Button>
      </div>
    </div>
  );
}

class PartPeopleModal extends Modal {
  private root: Root | null = null;

  constructor(app: App, private readonly kind: PartPeopleKind, private readonly choice: PartPeopleChoice, private readonly onApply: (names: string[]) => void) {
    super(app);
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES, 'atlas-share-modal');
  }

  onOpen(): void {
    this.setTitle(TITLES[this.kind]);
    this.root = createRoot(this.contentEl);
    this.root.render(
      <PartPeopleForm choice={this.choice} kind={this.kind} onCancel={() => this.close()} onApply={(names) => { this.close(); this.onApply(names); }} />,
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

export function openPartPeopleModal(app: App, kind: PartPeopleKind, choice: PartPeopleChoice, onApply: (names: string[]) => void): void {
  new PartPeopleModal(app, kind, choice, onApply).open();
}
