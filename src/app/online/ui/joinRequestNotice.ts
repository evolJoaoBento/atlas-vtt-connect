import type { JoinIdentity } from '../sharing/people/IdentityDesk';

/** Who a waiting player is, and the Link answer when a new device uses a known name. The notice that shows it comes with the session service. */
export interface JoinRequestInfo {
  identity: JoinIdentity | null;
  link: (() => void) | null;
}
