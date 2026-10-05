import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../../ui/primitives/Button';
import type { ConflictDefault } from '../../receive/PulledItems';
import type { MergeChunk } from '../diff3';
import { mergedText, type ConflictChoice } from '../mergeResult';
import type { MergeAnswer } from '../noteUpdate';

interface MergeViewProps {
  chunks: readonly MergeChunk[];
  preview: string | null;
  conflictDefault: ConflictDefault;
  onSave: (answer: MergeAnswer) => void;
  onCancel: () => void;
  /** Tells the dialog whether the result was edited by hand, so closing it can ask first. */
  onEdited?: (edited: boolean) => void;
}

const CHOICE_LABEL: Record<ConflictChoice, string> = { mine: 'Keep mine', theirs: 'Take theirs', both: 'Keep both' };
const TAKEN: Record<'mine' | 'theirs' | 'both', string> = { mine: 'Kept from mine', theirs: 'Taken from theirs', both: 'Changed alike on both sides' };

function Lines({ lines }: { lines: readonly string[] }): React.ReactElement {
  return <pre className="atlas-merge__lines">{lines.join('\n') || ' '}</pre>;
}

/** Side by side per conflict, one-sided changes taken; the result follows the choices until edited by hand. */
export function MergeView({ chunks, preview, conflictDefault, onSave, onCancel, onEdited }: MergeViewProps): React.ReactElement {
  const [choices, setChoices] = useState<Array<ConflictChoice | undefined>>([]);
  const [nextDefault, setNextDefault] = useState<ConflictDefault>(conflictDefault);
  const [edited, setEdited] = useState<string | null>(preview);
  const generated = useMemo(() => mergedText(chunks, choices, conflictDefault), [chunks, choices, conflictDefault]);
  const result = edited ?? generated;
  // Typed changes are never thrown away by a click: the conflict buttons wait until the receiver discards them.
  const byHand = edited !== null && edited !== generated;
  useEffect(() => { onEdited?.(byHand); }, [byHand, onEdited]);
  let conflict = -1;
  return (
    <div className="atlas-merge">
      <div className="atlas-merge__chunks">
        {chunks.map((chunk, index) => {
          if (chunk.kind === 'same') return <Lines key={index} lines={chunk.lines} />;
          if (chunk.kind !== 'conflict') {
            return (
              <div key={index} className="atlas-merge__taken">
                <span className="atlas-merge__label">{TAKEN[chunk.kind]}</span>
                <Lines lines={chunk.lines} />
              </div>
            );
          }
          const at = ++conflict;
          const choose = (choice: ConflictChoice): void => {
            const next = [...choices];
            next[at] = choice;
            setChoices(next);
            setEdited(null);
          };
          return (
            <div key={index} className="atlas-merge__conflict" role="group" aria-label={`Conflict ${at + 1}`}>
              <div className="atlas-merge__sides">
                <div className="atlas-merge__side"><span className="atlas-merge__label">Mine</span><Lines lines={chunk.mine} /></div>
                <div className="atlas-merge__side"><span className="atlas-merge__label">Base</span><Lines lines={chunk.base} /></div>
                <div className="atlas-merge__side"><span className="atlas-merge__label">Theirs</span><Lines lines={chunk.theirs} /></div>
              </div>
              <div className="atlas-merge__choices">
                {(['mine', 'theirs', 'both'] as const).map((choice) => (
                  <Button key={choice} size="sm" disabled={byHand} variant={(choices[at] ?? conflictDefault) === choice ? 'cta' : 'default'} onClick={() => choose(choice)}>
                    {CHOICE_LABEL[choice]}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <label className="atlas-merge__result">
        <span className="atlas-merge__label">Result</span>
        <textarea aria-label="Result" value={result} onChange={(event) => setEdited(event.target.value)} rows={12} />
      </label>
      {byHand && (
        <div className="atlas-merge__edited">
          <span>You edited the result, so the conflict buttons are off.</span>
          <Button size="sm" variant="default" onClick={() => setEdited(null)}>Discard my edits</Button>
        </div>
      )}
      <label className="atlas-merge__default">
        <span>For conflicts next time</span>
        <select className="dropdown" aria-label="For conflicts next time" value={nextDefault} onChange={(event) => setNextDefault(event.target.value as ConflictDefault)}>
          <option value="both">Keep both</option>
          <option value="mine">Keep mine</option>
          <option value="theirs">Take theirs</option>
        </select>
      </label>
      <div className="modal-button-container">
        <Button variant="default" onClick={onCancel}>Cancel</Button>
        <Button variant="cta" onClick={() => onSave({ text: result, conflictDefault: nextDefault })}>Save merge</Button>
      </div>
    </div>
  );
}
