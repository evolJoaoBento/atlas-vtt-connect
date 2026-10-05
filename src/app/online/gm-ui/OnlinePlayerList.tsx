import React from 'react';
import { Gem, X } from 'lucide-react';
import { Button } from '../../ui/primitives/Button';
import { LabelTooltip } from '../../ui/primitives/LabelTooltip';
import type { TokenControl } from '../control/TokenControl';
import type { SessionPlayer } from '../GmSession';
import type { OnlineSessionService } from '../OnlineSessionService';
import type { JoinIdentity } from '../sharing/people/IdentityDesk';
import {
  KNOWN_PERSON_MARK, NEW_PERSON_MARK, OBSIDIAN_PLAYER_LABEL, REMOVE_PLAYER_LABEL, linkToLabel, sameNameWarning,
} from '../ui/onlineCopy';
import type { PresentedSceneSummaries } from '../ui/presentedSceneSummary';
import { usePresentedSceneSummary, useTokenControlVersion } from './useOnlineState';

export type PlayerListService = Pick<OnlineSessionService, 'allow' | 'deny' | 'kick' | 'link' | 'linkPlaceholder'>;

interface OnlinePlayerListProps {
  players: readonly SessionPlayer[];
  /** Who each waiting Obsidian player is, by player id. */
  requests: Readonly<Record<string, JoinIdentity>>;
  control: TokenControl | null;
  service: PlayerListService;
  summaries: PresentedSceneSummaries;
}

type SameName = { personId: string | null; name: string; placeholder?: string };

/** Links a waiting player to the known person or the placeholder their name matches. */
function linkTo(service: PlayerListService, playerId: string, same: SameName): void {
  if (same.personId) service.link(playerId, same.personId);
  else if (same.placeholder) service.linkPlaceholder(playerId, same.placeholder);
}

/** Marks a player who joined from Atlas in Obsidian. */
function ObsidianMark(): React.ReactElement {
  return (
    <LabelTooltip label={OBSIDIAN_PLAYER_LABEL}>
      <span className="atlas-connect-panel__client" role="img" aria-label={OBSIDIAN_PLAYER_LABEL}><Gem aria-hidden="true" /></span>
    </LabelTooltip>
  );
}

/** `(known)` or `(new)` for an Obsidian player whose device checked; nothing for web players. */
function IdentityMark({ identity }: { identity: JoinIdentity | null }): React.ReactElement | null {
  if (!identity) return null;
  return <span className="atlas-connect-panel__identity">{identity.kind === 'known' ? KNOWN_PERSON_MARK : NEW_PERSON_MARK}</span>;
}

/** The warning for a new device using a known name, with Link to that person. */
function SameNameRow({ identity, onLink }: { identity: JoinIdentity | null; onLink: (sameName: SameName) => void }): React.ReactElement | null {
  const sameName = identity?.kind === 'new' ? identity.sameName : null;
  if (!sameName) return null;
  return (
    <div className="atlas-connect-panel__player-row atlas-connect-panel__same-name">
      <span className="atlas-connect-panel__warning" role="note">{sameNameWarning(sameName.name, sameName.personId === null)}</span>
      <Button size="sm" onClick={() => onLink(sameName)}>{linkToLabel(sameName.name)}</Button>
    </div>
  );
}

/**
 * Players waiting to join, and the players in the session with the tokens they control.
 * Tokens are given on the map, with a token's "Controlled by" menu.
 */
export function OnlinePlayerList({ players, requests, control, service, summaries }: OnlinePlayerListProps): React.ReactElement {
  const scene = usePresentedSceneSummary(summaries);
  useTokenControlVersion(control);

  const waiting = players.filter((player) => player.status === 'pending');
  const joined = players.filter((player) => player.status !== 'pending');
  const names = new Map(scene.characters.map((character) => [character.id, character.name]));

  return (
    <>
      {waiting.length > 0 && (
        <section className="atlas-connect-panel__section" aria-label="Waiting to join">
          <h3 className="atlas-connect-panel__heading">Waiting to join</h3>
          <ul className="atlas-connect-panel__players">
            {waiting.map((player) => (
              <li key={player.playerId} className="atlas-connect-panel__player" aria-label={player.name}>
                <div className="atlas-connect-panel__player-row">
                  <span className="atlas-connect-panel__name">{player.name}</span>
                  {player.client === 'obsidian' && <ObsidianMark />}
                  <IdentityMark identity={requests[player.playerId] ?? null} />
                  <Button variant="cta" size="sm" onClick={() => service.allow(player.playerId)}>Allow</Button>
                  <Button size="sm" onClick={() => service.deny(player.playerId)}>Deny</Button>
                </div>
                <SameNameRow identity={requests[player.playerId] ?? null} onLink={(same) => linkTo(service, player.playerId, same)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="atlas-connect-panel__section" aria-label="Players">
        <h3 className="atlas-connect-panel__heading">Players</h3>
        {joined.length === 0 ? (
          <p className="atlas-connect-panel__help">No players yet. Share the link to invite them.</p>
        ) : (
          <ul className="atlas-connect-panel__players">
            {joined.map((player) => {
              const tokens = control
                ? control.tokensOf(player.playerId).flatMap((id) => {
                  const name = names.get(id);
                  return name ? [{ id, name }] : [];
                })
                : [];
              return (
                <li key={player.playerId} className="atlas-connect-panel__player" aria-label={player.name}>
                  <div className="atlas-connect-panel__player-row">
                    <span className="atlas-connect-panel__name">{player.name}</span>
                    {player.client === 'obsidian' && <ObsidianMark />}
                    {player.status === 'gone' && <span className="atlas-connect-panel__note">Disconnected</span>}
                    <LabelTooltip label={`${REMOVE_PLAYER_LABEL} ${player.name}`}>
                      <Button variant="ghost" size="sm" aria-label={`${REMOVE_PLAYER_LABEL} ${player.name}`} onClick={() => service.kick(player.playerId)}>
                        <X />
                      </Button>
                    </LabelTooltip>
                  </div>
                  {tokens.length > 0 && (
                    <ul className="atlas-connect-panel__chips" aria-label={`Tokens of ${player.name}`}>
                      {tokens.map((token) => <li key={token.id} className="atlas-connect-panel__chip">{token.name}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
