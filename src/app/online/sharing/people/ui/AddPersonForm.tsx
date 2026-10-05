import React, { useState } from 'react';
import { Button } from '../../../../ui/primitives/Button';
import type { PeopleBook } from '../PeopleBook';

export const ADD_PERSON_HINT = 'Add someone by name before you meet them, to prepare notes and shares. They reach nothing until you link them to the person who joins.';

/** A name field and Add: the person is kept as someone not met yet. A taken or invalid name is explained, never changed. */
export function AddPersonForm({ people }: { people: Pick<PeopleBook, 'addPlaceholder'> }): React.ReactElement {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = (): void => {
    if (!name.trim()) return;
    const result = people.addPlaceholder(name);
    setProblem(result);
    if (!result) setName('');
  };
  return (
    <div className="atlas-people__add">
      <div className="atlas-people__row">
        <input
          className="atlas-people__name"
          value={name}
          placeholder="Add a person by name"
          aria-label="Name of the person to add"
          onChange={(event) => { setName(event.target.value); setProblem(null); }}
          onKeyDown={(event) => { if (event.key === 'Enter') add(); }}
        />
        <Button variant="cta" onClick={add} disabled={!name.trim()}>Add</Button>
      </div>
      <span className="atlas-people__hint">{ADD_PERSON_HINT}</span>
      {problem && <span className="atlas-people__problem" role="alert">{problem}</span>}
    </div>
  );
}
