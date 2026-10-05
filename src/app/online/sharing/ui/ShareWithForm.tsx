import React, { useState } from 'react';
import { Button } from '../../../ui/primitives/Button';
import type { MapShareMode } from '../model/mapShare';
import { TaggedText } from '../display/TaggedText';
import { NOT_MET_TEXT } from '../people/ui/peopleCopy';
import { LabelledCheck } from './LabelledCheck';

/** A person to tick: a known person by key, or a name the note uses that the list does not know (`name:<name>`). */
export interface ShareRow {
  key: string;
  name: string;
  known: boolean;
  /** Added by name, not met yet: it reaches nobody until linked. */
  placeholder?: boolean;
}

export interface ShareFormResult {
  everyone: boolean;
  people: string[];
  except: string[];
  mode: MapShareMode;
  notes: string[];
}

interface ShareWithFormProps {
  rows: readonly ShareRow[];
  initial: { everyone: boolean; people: string[]; except: string[] };
  /** For maps: the mode, every linked note (`hidden`: offered only for full shares) and the ticked ones. */
  map: {
    mode: MapShareMode;
    notes: ReadonlyArray<{ path: string; label: string; private: boolean; hidden?: boolean }>;
    ticked: string[];
    /** Why the map cannot be shared player-safe (`playerSafeRefusal`); only Full is offered then. */
    playerSafeRefused?: string;
  } | null;
  /** The note as one person gets it; null for maps. */
  preview: ((key: string) => Promise<string>) | null;
  /** A line of help under the preview (notes: how to keep a part back). */
  hint?: string;
  /** Why the item is not shared at all until the sender fixes it. */
  error?: string;
  warnings: readonly string[];
  onSave: (result: ShareFormResult) => void;
  onCancel: () => void;
}

/** A ticked note goes whole, as the fork's did: the fog over its pin or token holds back the pin, not the note. */
export const TICKED_NOTES_HINT = 'A ticked note is sent whole, even when its pin or token is under fog.';

const toggled = (list: readonly string[], key: string): string[] => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
const MODE_LABELS: Record<MapShareMode, string> = { 'player-safe': 'Player-safe', full: 'Full' };

export function ShareWithForm({ rows, initial, map, preview, hint, error, warnings, onSave, onCancel }: ShareWithFormProps): React.ReactElement {
  const [everyone, setEveryone] = useState(initial.everyone);
  const [people, setPeople] = useState(initial.people);
  const [except, setExcept] = useState(initial.except);
  const refused = map?.playerSafeRefused;
  const [mode, setMode] = useState<MapShareMode>(refused ? 'full' : map?.mode ?? 'player-safe');
  const [notes, setNotes] = useState(map?.ticked ?? []);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const known = rows.filter((row) => row.known);
  // A player-safe share never offers notes only GM-only pins or hidden tokens link to.
  const offered = map ? map.notes.filter((note) => mode === 'full' || !note.hidden) : [];
  const save = (): void => onSave({
    everyone, people, except: everyone ? except : [], mode,
    notes: notes.filter((path) => offered.some((note) => note.path === path && !note.private)),
  });
  return (
    <div className="atlas-share">
      {error && <p className="atlas-share__error" role="alert">{error}</p>}
      <section className="atlas-share__section">
        <LabelledCheck label="Everyone in my sessions" checked={everyone} onChange={() => setEveryone(!everyone)} />
        <ul className="atlas-share__people">
          {(everyone ? rows.filter((row) => row.known || except.includes(row.key)) : rows).map((row) => (
            <li key={row.key} className="atlas-share__person">
              {everyone
                ? <LabelledCheck label={`Except ${row.name}`} checked={except.includes(row.key)} onChange={() => setExcept(toggled(except, row.key))} />
                : <LabelledCheck label={row.name} checked={people.includes(row.key)} onChange={() => setPeople(toggled(people, row.key))} />}
              {row.placeholder && <span className="atlas-share__not-met">{NOT_MET_TEXT}</span>}
            </li>
          ))}
        </ul>
        {warnings.map((warning) => <p key={warning} className="atlas-share__warning" role="note">{warning}</p>)}
      </section>
      {map && (
        <section className="atlas-share__section" aria-label="Map">
          <div className="atlas-share__modes" role="radiogroup" aria-label="What to share">
            {(['player-safe', 'full'] as const).map((value) => (
              <LabelledCheck key={value} radio="atlas-share-mode" label={MODE_LABELS[value]} checked={mode === value}
                disabled={value === 'player-safe' && Boolean(refused)} onChange={() => setMode(value)} />
            ))}
          </div>
          {refused && <p className="atlas-share__warning" role="note">{refused}</p>}
          {offered.length > 0 && <h3 className="atlas-share__heading">Linked notes</h3>}
          {offered.length > 0 && mode === 'player-safe' && <p className="atlas-share__hint">{TICKED_NOTES_HINT}</p>}
          <ul className="atlas-share__people">
            {offered.map((note) => (
              <li key={note.path} className="atlas-share__note">
                <LabelledCheck label={note.label} checked={notes.includes(note.path)} disabled={note.private} onChange={() => setNotes(toggled(notes, note.path))} />
                {note.private && <span className="atlas-share__private">Private</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview && (
        <section className="atlas-share__section">
          <label className="atlas-share__preview-label">
            <span>Preview as</span>
            <select className="dropdown" aria-label="Preview as" defaultValue=""
              onChange={(event) => { const key = event.target.value; if (key) void preview(key).then(setPreviewText); }}>
              <option value="" disabled>Pick a person</option>
              {known.map((row) => <option key={row.key} value={row.key}>{row.placeholder ? `${row.name} (${NOT_MET_TEXT.toLowerCase()})` : row.name}</option>)}
            </select>
          </label>
          {previewText !== null && <pre className="atlas-share__preview"><TaggedText text={previewText} /></pre>}
          {hint && <p className="atlas-share__hint">{hint}</p>}
        </section>
      )}
      <div className="modal-button-container">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="cta" onClick={save}>Save</Button>
      </div>
    </div>
  );
}
