/** The GM's online play copy, shared by the panel, the toolbar, the palette and the eye button. */
export const ONLINE_SESSION_LABEL = 'Online session';
export const START_SESSION_LABEL = 'Start online session';
export const STOP_SESSION_LABEL = 'Stop online session';
export const SHOW_HANDOUT_LABEL = 'Show image to players…';
export const STOP_HANDOUT_LABEL = 'Stop showing image to players';
export const PRESENT_LABEL = 'Present to players';
export const STOP_PRESENTING_LABEL = 'Stop presenting';
export const REMOVE_PLAYER_LABEL = 'Remove player';
export const ONLINE_SECTION_TITLE = 'Online play';
export const JOIN_SESSION_LABEL = 'Join online session…';
export const SHARED_WITH_ME_BUTTON = 'Shared with me…';
export const OBSIDIAN_PLAYER_LABEL = 'Joined from Obsidian';
export const KNOWN_PERSON_MARK = '(known)';
export const NEW_PERSON_MARK = '(new)';
/** `notMet`: the name is of someone you added by name, who has never joined (Link hands over what you prepared for them). */
export const sameNameWarning = (name: string, notMet = false): string => (notMet
  ? `${name} was added by name and has not joined yet`
  : `Someone named ${name} is already in your people list`);
/** A join under the name of a player in the session, from another client than theirs (`GmSession`'s `sameNameAs`). */
export const otherClientWarning = (name: string, connected: boolean): string => (connected
  ? `${name} is already connected from another browser or device. Allowing adds a second ${name}.`
  : `Not the browser or device ${name} used before. Allowing gives them ${name}'s place and tokens.`);
export const linkToLabel =(name: string): string => `Link to ${name}`;
export const PEOPLE_LABEL = 'People';
