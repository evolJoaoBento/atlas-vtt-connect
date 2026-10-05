/** What each online session gives sharing: people recorded in the people list, and a share node per session. */
import { joinedSessionStore } from '../obsidian/joinedSessionStore';
import type { OnlineJoinService } from '../obsidian/OnlineJoinService';
import { onlineSessionStore } from '../onlineSessionStore';
import type { OnlineSessionService } from '../OnlineSessionService';
import type { SenderCatalogue } from './model/SenderCatalogue';
import type { PeopleBook } from './people/PeopleBook';
import { GM_PERSON_ID } from './people/peopleTypes';
import { recordSessionPeople } from './people/sessionPeople';
import type { SharingScope } from './sharingScope';
import { addPush, shareSessionStore } from './shareSessionStore';
import { GmShareHost } from './transport/GmShareHost';
import { PlayerShareLink } from './transport/PlayerShareLink';
import type { PushRequestBody } from './transport/ShareNode';

export interface SessionHookServices {
  joins: OnlineJoinService;
  people: PeopleBook;
  /** The hosting service; null on an Atlas Connect cannot host from, where only joined sessions share. */
  sessions: OnlineSessionService | null;
  catalogue: SenderCatalogue;
}

export function registerSessionHooks(plugin: Pick<SharingScope, 'register'>, services: SessionHookServices): void {
  const { joins, people } = services;
  // A joined session with a checked table: record the GM and everyone with a person id, now and on every presence.
  const record = (): void => {
    const identity = joins.identity;
    const players = joinedSessionStore.getState().session?.players ?? [];
    if (identity) void people.ready().then(() => recordSessionPeople(people, identity, players));
  };
  registerTransport(plugin, services);
  plugin.register(() => people.flush());
  plugin.register(joins.onIdentity(record));
  plugin.register(joinedSessionStore.subscribe(record));
}

/** Hosting and joining: each session with a checked table gets a share node, shown to the rest of the UI through `shareSessionStore`. */
function registerTransport(plugin: Pick<SharingScope, 'register'>, { joins, people, sessions, catalogue }: SessionHookServices): void {
  const nameOf = (tableId: string, personId: string, fallback: string): string => people.get(tableId, personId)?.name ?? fallback;
  const onPush = (from: string, push: PushRequestBody): void => addPush({ from, ...push, at: Date.now() });
  const reset = (): void => shareSessionStore.setState({ session: null, people: [], pushes: [] });

  sessions?.useSharingHooks({
    started: ({ session, table }) => {
      const host = new GmShareHost({ session, tableId: table.id, catalogue, onPush });
      host.start();
      const present = (): void => shareSessionStore.setState({
        people: host.people().map((person) => ({ personId: person.personId, name: nameOf(table.id, person.personId, person.name) })),
      });
      shareSessionStore.setState({ session: { role: 'gm', tableId: table.id, self: GM_PERSON_ID, node: host.node }, pushes: [] });
      present();
      const stopPresent = onlineSessionStore.subscribe(present);
      const stopNames = people.subscribe(present);
      return () => {
        stopPresent();
        stopNames();
        host.stop();
        reset();
      };
    },
  });
  plugin.register(() => sessions?.useSharingHooks(null));

  const link = new PlayerShareLink({ catalogue, onPush });
  joins.useShare(link);
  plugin.register(() => joins.useShare(null));
  const presentForPlayer = (): void => {
    const identity = joins.identity;
    if (!identity) return;
    const others = (joinedSessionStore.getState().session?.players ?? [])
      .filter((player) => player.personId && player.personId !== identity.personId)
      .map((player) => ({ personId: player.personId!, name: nameOf(identity.tableId, player.personId!, player.name) }));
    shareSessionStore.setState({ people: [{ personId: GM_PERSON_ID, name: nameOf(identity.tableId, GM_PERSON_ID, identity.gmName) }, ...others] });
  };
  plugin.register(joins.onIdentity((identity) => {
    if (!identity) {
      link.deactivate();
      reset();
      return;
    }
    const node = link.activate(identity);
    shareSessionStore.setState({ session: { role: 'player', tableId: identity.tableId, self: identity.personId, node }, pushes: [] });
    presentForPlayer();
  }));
  plugin.register(joinedSessionStore.subscribe(presentForPlayer));
  // The list hands out names after a session first shows someone: refresh them then, so the store does not keep a join name.
  plugin.register(people.subscribe(presentForPlayer));
}
