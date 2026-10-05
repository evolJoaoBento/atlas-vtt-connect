import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../../ui/primitives/Button';
import type { PushRequest, SessionPerson } from '../../shareSessionStore';
import { LabelledCheck } from '../../ui/LabelledCheck';
import { pullAcceptedPush } from '../pushPrompts';
import { pullFailedText, shareErrorText } from '../shareErrors';
import type { ItemState, ListedItem, SharedWithMe } from '../SharedWithMe';

export const NOTHING_SHARED_TEXT = 'Nothing is shared with you yet.';
const STATE_TEXT: Record<ItemState, string> = { new: 'New', updated: 'Updated', current: 'Up to date' };

type Service = Pick<SharedWithMe, 'refresh' | 'pull' | 'pullPushed'>;

interface ListProps {
  service: Service;
  people: readonly SessionPerson[];
  pushes: readonly PushRequest[];
  dismissPush: (push: PushRequest) => void;
  onPulled: (path: string) => void;
  onProblem: (text: string) => void;
}

function ItemRow({ item, onPull, titles }: { item: ListedItem; onPull: (linked: string[]) => Promise<void>; titles: ReadonlyMap<string, string> }): React.ReactElement {
  const [linked, setLinked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pull = (): void => {
    setBusy(true);
    setProblem(null);
    onPull(linked).catch((error: unknown) => setProblem(pullFailedText(error))).finally(() => setBusy(false));
  };
  const toggle = (id: string): void => setLinked(linked.includes(id) ? linked.filter((other) => other !== id) : [...linked, id]);
  return (
    <li className="atlas-shared__item">
      <div className="atlas-shared__row">
        <span className="atlas-shared__title">{item.title}</span>
        {item.kind === 'map' && <span className="atlas-shared__kind">{item.mode === 'full' ? 'Map, full' : 'Map'}</span>}
        <span className={`atlas-shared__state atlas-shared__state--${item.state}`}>{STATE_TEXT[item.state]}</span>
        <Button variant={item.state === 'current' ? 'default' : 'cta'} size="sm" disabled={busy} onClick={pull}>
          {item.state === 'updated' ? 'Pull update' : 'Pull'}
        </Button>
      </div>
      {item.kind === 'map' && (item.linked ?? []).length > 0 && (
        <ul className="atlas-shared__linked" aria-label={`Linked notes of ${item.title}`}>
          {(item.linked ?? []).map((id) => (
            <li key={id}>
              <LabelledCheck label={`Also pull ${titles.get(id) ?? 'a linked note'}`} checked={linked.includes(id)} onChange={() => toggle(id)} />
            </li>
          ))}
        </ul>
      )}
      {problem && <span className="atlas-shared__problem" role="alert">{problem}</span>}
    </li>
  );
}

function PersonSection({ person, service, onPulled }: { person: SessionPerson; service: Service; onPulled: (path: string) => void }): React.ReactElement {
  const [items, setItems] = useState<ListedItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback((): void => {
    service.refresh(person.personId).then((catalogue) => setItems(catalogue.items), (error: unknown) => setProblem(shareErrorText(error)));
  }, [person.personId, service]);
  useEffect(() => { load(); }, [load]);
  const titles = new Map((items ?? []).map((item) => [item.item, item.title]));
  return (
    <section className="atlas-shared__person" aria-label={person.name}>
      <h3 className="atlas-shared__heading">{person.name}</h3>
      {problem && <p className="atlas-shared__problem" role="alert">{problem}</p>}
      {items === null && !problem && <p className="atlas-shared__help">Asking {person.name}…</p>}
      {items?.length === 0 && <p className="atlas-shared__help">{NOTHING_SHARED_TEXT}</p>}
      <ul className="atlas-shared__items">
        {items?.map((item) => (
          <ItemRow key={item.item} item={item} titles={titles} onPull={async (linked) => {
            const outcome = await service.pull(person.personId, item, linked);
            if ('path' in outcome) onPulled(outcome.path);
            load();
          }} />
        ))}
      </ul>
    </section>
  );
}

/** Push requests first, then everyone in the session with what they share. */
export function SharedWithMeList({ service, people, pushes, dismissPush, onPulled, onProblem }: ListProps): React.ReactElement {
  const nameOf = (personId: string): string => people.find((person) => person.personId === personId)?.name ?? 'Someone';
  return (
    <div className="atlas-shared">
      {pushes.length > 0 && (
        <section className="atlas-shared__person" aria-label="Asked to pull">
          <h3 className="atlas-shared__heading">Asked to pull</h3>
          <ul className="atlas-shared__items">
            {pushes.map((push) => (
              <li key={`${push.from}/${push.item}`} className="atlas-shared__row">
                <span className="atlas-shared__title">{`${nameOf(push.from)} asks you to pull ${push.title}.`}</span>
                <Button variant="cta" size="sm" onClick={() => {
                  dismissPush(push);
                  pullAcceptedPush(service, push, { pulled: onPulled, failed: onProblem });
                }}>Pull</Button>
                <Button variant="default" size="sm" onClick={() => dismissPush(push)}>Not now</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {people.length === 0 && <p className="atlas-shared__help">Nobody else in this session shares with Atlas in Obsidian.</p>}
      {people.map((person) => <PersonSection key={person.personId} person={person} service={service} onPulled={onPulled} />)}
    </div>
  );
}
