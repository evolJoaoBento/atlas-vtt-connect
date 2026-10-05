/**
 * The GM's sharing in a hosted session, a `GmSession` handler. Only admitted Obsidian players
 * with a person id take part. Whatever a player sends is stamped with their person id; what is
 * for `gm` reaches the GM's own node, the rest goes through the relay, which stores nothing.
 * One person on two devices is one person: the most recently admitted device is reached, and they
 * are gone only when their last device is.
 */
import type { Hasher } from '../../assets/assetIds';
import type { SessionHandler, SessionPlayer } from '../../gmSessionTypes';
import { RateLimit } from '../../rateLimit';
import type { ChannelPort } from '../../transport/types';
import { GM_PERSON_ID } from '../people/peopleTypes';
import type { SenderCatalogue } from '../model/SenderCatalogue';
import type { SessionPerson } from '../shareSessionStore';
import { forTable } from './forTable';
import { SHARE_LIMITS } from './shareLimits';
import { ShareNode, type ShareNodeOptions } from './ShareNode';
import { ShareRelay } from './ShareRelay';
import { decodeShare, encodeShare, type ShareMessage } from './shareProtocol';

export interface GmShareHostOptions {
  session: {
    use(handler: SessionHandler): () => void;
    assetChannel(playerId: string): ChannelPort | null;
    getPlayers(): SessionPlayer[];
  };
  tableId: string;
  catalogue: Pick<SenderCatalogue, 'list' | 'open'>;
  onPush?: ShareNodeOptions['onPush'];
  hash?: Hasher;
}

const ASKS = new Set<ShareMessage['type']>(['share-list-request', 'share-pull', 'share-push', 'share-start']);

/** An ask that counts against the rate limit: a map's images (pulled and sent one after another) are bounded by queues instead. */
function limited(message: ShareMessage): boolean {
  if (!ASKS.has(message.type)) return false;
  if (message.type === 'share-pull') return !message.item.includes('/');
  return message.type !== 'share-start' || message.kind !== 'image';
}

export class GmShareHost implements SessionHandler {
  readonly node: ShareNode;
  private readonly relay: ShareRelay;
  private readonly limit = new RateLimit(SHARE_LIMITS.requestsPerSecond);
  /** When each device was last admitted, for "the most recent". */
  private readonly admitted = new Map<string, number>();
  private admissions = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: GmShareHostOptions) {
    this.node = new ShareNode({
      self: GM_PERSON_ID,
      catalogue: forTable(options.catalogue, options.tableId, GM_PERSON_ID),
      send: (to, data) => this.portOf(to)?.send(data),
      ...(options.onPush ? { onPush: options.onPush } : {}),
      ...(options.hash ? { hash: options.hash } : {}),
    });
    this.relay = new ShareRelay((to, data) => this.portOf(to)?.send(data), (to) => this.portOf(to)?.bufferedAmount() ?? 0);
  }

  start(): void {
    this.unsubscribe ??= this.options.session.use(this);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.node.stop();
    this.relay.stop();
  }

  /** The people in the session who take part in sharing, once each. */
  people(): SessionPerson[] {
    const people = new Map<string, SessionPerson>();
    for (const player of this.taking()) people.set(player.personId, { personId: player.personId, name: player.name });
    return [...people.values()];
  }

  relayMappings(): number {
    return this.relay.mappings();
  }

  onAdmitted(player: SessionPlayer): void {
    // Admitted again without leaving: a take-over, which fires no `onGone`. The old link's transfers are over.
    const takeOver = this.admitted.has(player.playerId);
    this.admitted.set(player.playerId, ++this.admissions);
    if (takeOver) this.release(player);
  }

  onAssetData(player: SessionPlayer, data: unknown): void {
    const person = player.personId;
    if (!person || player.client !== 'obsidian') return;
    const decoded = decodeShare(data);
    if (decoded.kind === 'chunk') {
      if (!this.relay.chunk(person, decoded.chunk)) this.node.chunk(person, decoded.chunk);
      return;
    }
    if (decoded.kind !== 'message') return;
    // Who sent it is the GM's to say: a player's own `from` is replaced.
    const message: ShareMessage = { ...decoded.message, from: person };
    if (limited(message) && !this.limit.allow(person, Date.now())) {
      this.turnDown(person, message);
      return;
    }
    if (message.to === GM_PERSON_ID) this.node.receive(person, { ...message, from: person });
    else if (this.portOf(message.to)) this.relay.message(person, message);
    else this.turnDown(person, message, 'gone');
  }

  onGone(player: SessionPlayer): void {
    this.admitted.delete(player.playerId);
    this.release(player);
  }

  /** Ends a person's transfers and requests, unless another device of theirs is connected. */
  private release(player: SessionPlayer): void {
    const person = player.personId;
    if (!person || this.taking().some((other) => other.personId === person && other.playerId !== player.playerId)) return;
    this.relay.gone(person);
    this.node.peerGone(person);
  }

  /** Answers an ask that cannot go on, instead of leaving the asker to wait out the timeout. */
  private turnDown(person: string, message: ShareMessage, reason: 'busy' | 'gone' = 'busy'): void {
    if (message.type === 'share-start') {
      if (message.to === GM_PERSON_ID) {
        this.portOf(person)?.send(encodeShare({ v: 1, type: 'share-cancel', to: person, from: GM_PERSON_ID, handle: message.handle }));
        this.node.receive(person, { v: 1, type: 'share-denied', to: GM_PERSON_ID, from: person, req: message.req, reason });
      } else if (reason === 'busy') {
        this.relay.refuse(person, message);
      } else {
        this.portOf(person)?.send(encodeShare({ v: 1, type: 'share-cancel', to: person, from: message.to, handle: message.handle }));
      }
      return;
    }
    if ('req' in message && message.type !== 'share-denied') {
      this.portOf(person)?.send(encodeShare({ v: 1, type: 'share-denied', to: person, from: message.to, req: message.req, reason }));
    }
  }

  /** Admitted Obsidian players with a person id. */
  private taking(): Array<SessionPlayer & { personId: string }> {
    return this.options.session.getPlayers().filter((player): player is SessionPlayer & { personId: string } =>
      player.status === 'admitted' && player.client === 'obsidian' && player.personId !== undefined);
  }

  private portOf(personId: string): ChannelPort | null {
    let latest: SessionPlayer | null = null;
    for (const player of this.taking()) {
      if (player.personId === personId && (!latest || (this.admitted.get(player.playerId) ?? 0) >= (this.admitted.get(latest.playerId) ?? 0))) latest = player;
    }
    return latest ? this.options.session.assetChannel(latest.playerId) : null;
  }
}
