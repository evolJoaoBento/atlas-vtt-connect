import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../../ui/primitives/Button';
import { LabelTooltip } from '../../../../ui/primitives/LabelTooltip';
import type { PeopleBook } from '../PeopleBook';
import type { Placeholder } from '../placeholderTypes';
import { NOT_MET_TEXT } from './peopleCopy';

interface PlaceholderRowProps {
  placeholder: Placeholder;
  people: Pick<PeopleBook, 'renamePlaceholder' | 'removePlaceholder'>;
  confirmRemove: (who: { name: string; placeholder: true }) => Promise<boolean>;
}

/** Someone added by name, not met yet: renamed or removed like anyone, never linked from here (the person who joins is). */
export function PlaceholderRow({ placeholder, people, confirmRemove }: PlaceholderRowProps): React.ReactElement {
  const [name, setName] = useState(placeholder.name);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = (): void => {
    if (name.trim() === placeholder.name) {
      setName(placeholder.name);
      setProblem(null);
      return;
    }
    const result = people.renamePlaceholder(placeholder.name, name);
    setProblem(result);
    if (!result) setName(name.trim());
  };
  return (
    <li className="atlas-people__person">
      <div className="atlas-people__row">
        <input
          className="atlas-people__name"
          value={name}
          aria-label={`Name of ${placeholder.name}`}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
        />
        <LabelTooltip label={`Remove ${placeholder.name}`}>
          <Button
            variant="ghost" size="sm" aria-label={`Remove ${placeholder.name}`}
            onClick={() => { void confirmRemove({ name: placeholder.name, placeholder: true }).then((yes) => { if (yes) people.removePlaceholder(placeholder.name); }); }}
          >
            <X />
          </Button>
        </LabelTooltip>
      </div>
      <span className="atlas-people__seen">{NOT_MET_TEXT}</span>
      {problem && <span className="atlas-people__problem" role="alert">{problem}</span>}
    </li>
  );
}
