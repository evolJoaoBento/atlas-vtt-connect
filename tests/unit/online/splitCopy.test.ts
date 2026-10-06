import { describe, expect, it } from 'vitest';
import {
  badge, CAP_NOTE, capPanelNote, closedNotice, couldntOpen, diceRollerLabel, EVERYONE_BACK_COMMAND, EVERYONE_BACK_LABEL,
  NO_PLAYERS_ROW, PAUSED_BANNER, PRESENT_TO_HEADING, PRESENT_TO_NO_SCENE, presentSceneToHeading, presentToLabel, rowLabel,
  sceneChip, splitStatus, UPDATE_ATLAS_NOTE,
} from '../../../src/app/online/split/splitCopy';

/** Words that keep their capitals mid-sentence: the test's player and scene names, and proper nouns. */
const PROPER = new Set(['Anna', 'Ben', 'Cara', 'Dan', 'Eve', 'Cave', 'Tower', 'GM', 'Atlas', 'VTT']);

function expectSentenceCase(text: string): void {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) expectSentence(sentence, text);
}

function expectSentence(sentence: string, text: string): void {
  const words = sentence.split(/\s+/).map((word) => word.replace(/[^\p{L}']/gu, '')).filter((word) => word.length > 0);
  const [first, ...rest] = words;
  if (first !== undefined && /^\p{L}/u.test(sentence)) expect(first[0], text).toBe(first[0]!.toUpperCase());
  for (const word of rest) if (!PROPER.has(word)) expect(word, `"${word}" in "${text}"`).toBe(word.toLowerCase());
}

describe('the split party wording', () => {
  it('writes every label in sentence case', () => {
    const texts = [
      presentToLabel([], 2, true), presentToLabel(['Anna', 'Ben'], 3, true), presentToLabel(['Anna', 'Ben', 'Cara', 'Dan', 'Eve'], 6, false),
      presentToLabel([], 2, false), PRESENT_TO_NO_SCENE, PRESENT_TO_HEADING, presentSceneToHeading('Cave'),
      rowLabel('Anna', { kind: 'here' }, false), rowLabel('Anna', { kind: 'on', scene: 'Tower' }, true), rowLabel('Anna', { kind: 'no-scene' }, false),
      NO_PLAYERS_ROW, EVERYONE_BACK_LABEL, EVERYONE_BACK_COMMAND, CAP_NOTE, capPanelNote(), splitStatus(1), splitStatus(2),
      sceneChip('Cave'), closedNotice(['Anna', 'Ben'], 'Cave'), PAUSED_BANNER, UPDATE_ATLAS_NOTE, couldntOpen('Cave'), badge(1), badge(3),
      diceRollerLabel('Anna', 'Cave'),
    ];
    for (const text of texts) expectSentenceCase(text);
  });

  it('Present to: Anna, Ben and 3 more', () => {
    expect(presentToLabel(['Anna', 'Ben', 'Cara', 'Dan', 'Eve'], 6, false)).toBe('Present to: Anna, Ben and 3 more');
    expect(presentToLabel(['Anna', 'Ben', 'Cara', 'Dan'], 4, false)).toBe('Present to: Anna, Ben and 2 more');
    expect(presentToLabel(['Anna', 'Ben', 'Cara'], 4, true)).toBe('Present to: Anna, Ben, Cara');
    expect(presentToLabel(['Anna', 'Ben'], 3, true)).toBe('Present to: Anna, Ben');
    expect(presentToLabel(['Anna'], 3, false)).toBe('Present to: Anna');
  });

  it('says everyone only for a presented tab every player sees, and nobody for a tab no player sees', () => {
    expect(presentToLabel(['Anna', 'Ben'], 2, true)).toBe('Present to: everyone');
    // Presented with nobody connected yet: whoever joins follows it.
    expect(presentToLabel([], 0, true)).toBe('Present to: everyone');
    // Everyone assigned to a tab that is not presented: named, since followers would not see it.
    expect(presentToLabel(['Anna', 'Ben'], 2, false)).toBe('Present to: Anna, Ben');
    expect(presentToLabel([], 2, true)).toBe('Present to: nobody');
    expect(presentToLabel([], 0, false)).toBe('Present to: nobody');
    expect(PRESENT_TO_NO_SCENE).toBe('Present to: no scene open');
  });

  it('labels the menus and their rows', () => {
    expect(PRESENT_TO_HEADING).toBe('Present to');
    expect(presentSceneToHeading('Cave')).toBe('Present Cave to');
    expect(rowLabel('Anna', { kind: 'here' }, false)).toBe('Anna');
    expect(rowLabel('Anna', { kind: 'on', scene: 'Cave' }, false)).toBe('Anna · on Cave');
    expect(rowLabel('Anna', { kind: 'no-scene' }, false)).toBe('Anna · no scene');
    expect(rowLabel('Anna', { kind: 'here' }, true)).toBe('Anna · disconnected');
    expect(rowLabel('Anna', { kind: 'on', scene: 'Cave' }, true)).toBe('Anna · on Cave · disconnected');
    expect(NO_PLAYERS_ROW).toBe('No players connected');
    expect(EVERYONE_BACK_LABEL).toBe('Everyone back to the presented scene');
    expect(EVERYONE_BACK_COMMAND).toBe('Bring all players back to the presented scene');
  });

  it('states the cap, the split and the notices', () => {
    expect(CAP_NOTE).toBe('At most 4 scenes at once');
    expect(capPanelNote()).toBe('Players are on 4 scenes, the most at once. Bring players back to free one.');
    expect(splitStatus(1)).toBe('1 player is on another scene.');
    expect(splitStatus(2)).toBe('2 players are on other scenes.');
    expect(sceneChip('Cave')).toBe('On Cave');
    expect(closedNotice(['Anna'], 'Cave')).toBe('Anna went back to the presented scene: Cave was closed.');
    expect(closedNotice(['Anna', 'Ben'], 'Cave')).toBe('Anna and Ben went back to the presented scene: Cave was closed.');
    expect(closedNotice(['Anna', 'Ben', 'Cara'], 'Cave')).toBe('Anna, Ben and Cara went back to the presented scene: Cave was closed.');
    expect(PAUSED_BANNER).toBe("The GM is on another scene. You can't move tokens until they're back.");
    expect(UPDATE_ATLAS_NOTE).toBe('Update Atlas VTT to show different scenes to different players.');
    expect(couldntOpen('Cave')).toBe("Couldn't open Cave.");
    expect(badge(1)).toBe('1 player');
    expect(badge(3)).toBe('3 players');
    expect(diceRollerLabel('Anna', 'Cave')).toBe('Anna · Cave');
  });
});
