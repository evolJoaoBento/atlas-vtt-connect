/**
 * A player's sharing: the node for the joined session, on the assets channel to the GM. It is
 * active only once the GM's table proof checked (`activate`), and takes only messages the GM
 * addressed to this player and stamped with a sender.
 */
import type { Hasher } from '../../assets/assetIds';
import type { PlayerShareHandler } from '../../PlayerSession';
import type { ChannelPort } from '../../transport/types';
import type { SenderCatalogue } from '../model/SenderCatalogue';
import { forTable } from './forTable';
import { ShareNode, type ShareNodeOptions } from './ShareNode';
import { decodeShare } from './shareProtocol';

/** Everything from the GM arrives on one link: that is the hop. */
const GM_HOP = 'gm-link';

export interface PlayerShareLinkOptions {
  catalogue: Pick<SenderCatalogue, 'list' | 'open'>;
  onPush?: ShareNodeOptions['onPush'];
  hash?: Hasher;
}

export class PlayerShareLink implements PlayerShareHandler {
  private port: ChannelPort | null = null;
  private current: { node: ShareNode; personId: string } | null = null;

  constructor(private readonly options: PlayerShareLinkOptions) {}

  get node(): ShareNode | null {
    return this.current?.node ?? null;
  }

  activate(identity: { tableId: string; personId: string }): ShareNode {
    this.current?.node.stop();
    const node = new ShareNode({
      self: identity.personId,
      catalogue: forTable(this.options.catalogue, identity.tableId, identity.personId),
      send: (_to, data) => this.port?.send(data),
      ...(this.options.onPush ? { onPush: this.options.onPush } : {}),
      ...(this.options.hash ? { hash: this.options.hash } : {}),
    });
    this.current = { node, personId: identity.personId };
    return node;
  }

  deactivate(): void {
    this.current?.node.stop();
    this.current = null;
  }

  connected(port: ChannelPort): void {
    this.port = port;
  }

  receive(data: unknown): void {
    const current = this.current;
    if (!current) return;
    const decoded = decodeShare(data);
    if (decoded.kind === 'chunk') current.node.chunk(GM_HOP, decoded.chunk);
    else if (decoded.kind === 'message' && decoded.message.from && decoded.message.to === current.personId) {
      current.node.receive(GM_HOP, { ...decoded.message, from: decoded.message.from });
    }
  }

  disconnected(): void {
    this.port = null;
    this.current?.node.disconnected();
  }
}
