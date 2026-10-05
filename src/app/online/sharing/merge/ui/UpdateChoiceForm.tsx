import React, { useState } from 'react';
import { Button } from '../../../../ui/primitives/Button';
import type { UpdateChoice } from '../../receive/PulledItems';
import { LabelledCheck } from '../../ui/LabelledCheck';
import type { AskResult } from '../noteUpdate';

const CHOICES: ReadonlyArray<{ choice: UpdateChoice; label: string }> = [
  { choice: 'both', label: 'Keep both' },
  { choice: 'mine', label: 'Keep mine' },
  { choice: 'theirs', label: 'Take theirs' },
  { choice: 'resolve', label: 'Resolve conflicts' },
  { choice: 'auto', label: 'Auto merge' },
];

export function UpdateChoiceForm({ title, personName, onAnswer }: { title: string; personName: string; onAnswer: (answer: AskResult) => void }): React.ReactElement {
  const [remember, setRemember] = useState(false);
  const [silent, setSilent] = useState(false);
  return (
    <div className="atlas-merge-choice">
      <h3 className="atlas-merge-choice__title">{`${title} changed on both sides`}</h3>
      <p className="atlas-merge-choice__help">{`You edited your copy, and ${personName} changed theirs since your last pull.`}</p>
      <LabelledCheck label="Remember for this note" checked={remember} onChange={() => setRemember(!remember)} />
      <LabelledCheck label="Save auto merges without showing them" checked={silent} onChange={() => setSilent(!silent)} />
      <div className="modal-button-container atlas-merge-choice__actions">
        {CHOICES.map(({ choice, label }) => (
          <Button key={choice} variant={choice === 'resolve' ? 'cta' : 'default'} onClick={() => onAnswer({ choice, remember, silent })}>{label}</Button>
        ))}
      </div>
    </div>
  );
}
