/**
 * The GM's join requests, by identity: Obsidian players' device proofs go through the
 * `IdentityDesk` (known or new, and the warning for a new device with a known name) before the GM
 * is asked, and admitting signs a table proof for the player's current device proof. Web players
 * and Obsidian players without a device proof are asked about as before, without an identity.
 */
import type { GmSession, SessionPlayer } from '../../GmSession';
import { onlineSessionStore } from '../../onlineSessionStore';
import type { DeviceProof } from '../../protocol';
import type { JoinRequestInfo } from '../../ui/joinRequestNotice';
import type { IdentityDesk, JoinIdentity, LinkTarget } from './IdentityDesk';

/** How often a table proof is signed again because a newer device proof arrived while it was being signed. */
const MAX_RESIGNS = 3;

export interface HostIdentityOptions {
  /** Null when this Atlas has no table key: every request is asked about without an identity. */
  desk: IdentityDesk | null;
  /** The session being hosted. */
  session: () => GmSession | null;
  showRequest: (player: SessionPlayer, answer: (allow: boolean) => void, info?: JoinRequestInfo) => { hide(): void };
}

export class HostIdentity {
  private readonly notices = new Map<string, { hide(): void }>();
  /** Requests whose device proof is being checked: they cannot be admitted yet. */
  private readonly identifying = new Set<string>();
  /** Requests being admitted: a second answer is ignored. */
  private readonly admitting = new Set<string>();
  private stopped = false;

  constructor(private readonly options: HostIdentityOptions) {}

  /** A player asks to join. */
  joinRequest(player: SessionPlayer, device: DeviceProof | null): void {
    const { desk } = this.options;
    if (desk && device && player.client === 'obsidian') void this.identify(player, device, desk);
    else this.show(player, null);
  }

  /** The request is no longer open: answered, expired, withdrawn or the session stopped. */
  requestClosed(playerId: string): void {
    this.options.desk?.closed(playerId);
    this.notices.get(playerId)?.hide();
    this.notices.delete(playerId);
    const requests = Object.fromEntries(Object.entries(onlineSessionStore.getState().requests).filter(([id]) => id !== playerId));
    onlineSessionStore.setState({ requests });
  }

  /** Admits the waiting player as who their device is: a known person or a new one. */
  allow(playerId: string): void {
    this.admit(playerId, null);
  }

  /** Admits a new device as a known person: only the GM links. */
  link(playerId: string, personId: string): void {
    this.admit(playerId, personId);
  }

  /** Admits a new device as someone added by name before meeting them (by the placeholder's id): only the GM links. */
  linkPlaceholder(playerId: string, placeholderId: string): void {
    this.admit(playerId, { placeholder: placeholderId });
  }

  deny(playerId: string): void {
    this.options.session()?.deny(playerId);
  }

  stop(): void {
    this.stopped = true;
    this.notices.forEach((notice) => notice.hide());
    this.notices.clear();
    onlineSessionStore.setState({ requests: {} });
  }

  private show(player: SessionPlayer, identity: JoinIdentity | null): void {
    const sameName = identity?.kind === 'new' ? identity.sameName : null;
    this.notices.get(player.playerId)?.hide();
    const info: JoinRequestInfo = { identity, link: sameName ? () => (sameName.personId ? this.link(player.playerId, sameName.personId) : sameName.placeholder ? this.linkPlaceholder(player.playerId, sameName.placeholder) : undefined) : null };
    this.notices.set(player.playerId, this.options.showRequest(player, (allow) => (allow ? this.allow(player.playerId) : this.deny(player.playerId)), info));
  }

  private isWaiting(playerId: string): boolean {
    return this.options.session()?.getPlayers().some((player) => player.playerId === playerId && player.status === 'pending') ?? false;
  }

  /** Checks an Obsidian player's device; a proof that fails is denied, the others are asked about. */
  private async identify(player: SessionPlayer, device: DeviceProof, desk: IdentityDesk): Promise<void> {
    const { playerId } = player;
    this.identifying.add(playerId);
    let identity: JoinIdentity | null = null;
    try {
      identity = await desk.identify(player, device);
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not check a join request:', error);
    } finally {
      this.identifying.delete(playerId);
    }
    if (this.stopped) return;
    if (!this.isWaiting(playerId)) {
      desk.closed(playerId);
      return;
    }
    if (!identity) {
      this.deny(playerId);
      return;
    }
    onlineSessionStore.setState({ requests: { ...onlineSessionStore.getState().requests, [playerId]: identity } });
    this.show(player, identity);
  }

  private admit(playerId: string, linkTo: LinkTarget): void {
    const session = this.options.session();
    const { desk } = this.options;
    if (!session || this.stopped || this.identifying.has(playerId) || this.admitting.has(playerId)) return;
    if (!desk?.identityOf(playerId)) {
      // No identity (a web player, or no table): admitted as before, and there is nothing to link.
      if (!linkTo) session.allow(playerId);
      return;
    }
    this.admitting.add(playerId);
    void this.admitIdentified(session, desk, playerId, linkTo)
      .catch(async (error: unknown) => {
        console.error('[Atlas VTT Connect] Could not admit a player:', error);
        await this.askAgain(session, desk, playerId);
      })
      .catch((error: unknown) => {
        console.error('[Atlas VTT Connect] Could not ask about a player again; denied:', error);
        this.deny(playerId);
      })
      .finally(() => this.admitting.delete(playerId));
  }

  /** Works the request's identity out again from its current device proof, and asks the GM again. */
  private async askAgain(session: GmSession, desk: IdentityDesk, playerId: string): Promise<void> {
    const player = session.getPlayers().find((other) => other.playerId === playerId && other.status === 'pending');
    const device = session.deviceOf(playerId);
    if (!player || !device || this.stopped) return;
    await this.identify(player, device, desk);
  }

  /** Signs for the entry's current device proof: a takeover while waiting may have refreshed it. */
  private async admitIdentified(session: GmSession, desk: IdentityDesk, playerId: string, linkTo: LinkTarget): Promise<void> {
    for (let attempt = 0; attempt < MAX_RESIGNS; attempt++) {
      const device = session.deviceOf(playerId);
      const result = await desk.admission(playerId, linkTo, device ?? undefined);
      if (this.stopped || this.options.session() !== session) return;
      if ('refused' in result) {
        // A failed proof is denied, like one on the first request; a missing person is asked about again.
        if (result.refused === 'proof') this.deny(playerId);
        else if (result.refused === 'person') await this.askAgain(session, desk, playerId);
        return;
      }
      const { admission } = result;
      if (session.deviceOf(playerId)?.nonce !== device?.nonce && attempt < MAX_RESIGNS - 1) continue;
      session.allow(playerId, admission);
      return;
    }
  }
}
