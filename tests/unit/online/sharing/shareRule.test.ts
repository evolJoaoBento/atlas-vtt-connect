import { describe, expect, it } from 'vitest';
import { partAllows, ruleReaches } from '../../../../src/app/online/sharing/model/audience';
import { formatShareRule, parseShareRule, unknownRuleNames } from '../../../../src/app/online/sharing/model/shareRule';
import type { Person } from '../../../../src/app/online/sharing/people/peopleTypes';

const T = 'T'.repeat(43);
const person = (personId: string, name: string, extra: Partial<Person> = {}): Person =>
  ({ tableId: T, personId, name, formerNames: [], devices: [], aliases: [], lastSeen: 0, ...extra });
const ana = person('ana', 'Ana', { formerNames: ['Annie'] });
const ben = person('ben', 'Ben');
const cara = person('cara', 'Cara');
const people = { byName: (name: string): Person | null => [ana, ben, cara].find((p) => p.name === name || p.formerNames.includes(name)) ?? null };
const as = (p: Person): { tableId: string; personId: string } => ({ tableId: p.tableId, personId: p.personId });

describe('atlas-share', () => {
  it('reads every form of the spec', () => {
    expect(parseShareRule('public')).toEqual({ private: false, public: true, only: [], except: [] });
    expect(parseShareRule('private')).toMatchObject({ private: true });
    expect(parseShareRule(undefined)).toEqual({ private: false, public: false, only: [], except: [] });
    expect(parseShareRule(['Ana', 'Ben'])).toMatchObject({ only: ['Ana', 'Ben'] });
    expect(parseShareRule(['only Ana', 'ONLY Ben'])).toMatchObject({ only: ['Ana', 'Ben'] });
    expect(parseShareRule(['public', 'except Cara'])).toMatchObject({ public: true, except: ['Cara'] });
    expect(parseShareRule('Ana, Ben')).toMatchObject({ only: ['Ana', 'Ben'] });
    expect(parseShareRule(['  ', 'Ana'])).toMatchObject({ only: ['Ana'] });
  });

  it('decides who it reaches: private wins over everything, except over a name, unknown except reaches nobody', () => {
    expect(ruleReaches(parseShareRule('public'), as(cara), people)).toBe(true);
    expect(ruleReaches(parseShareRule(['Ana', 'Ben']), as(ana), people)).toBe(true);
    expect(ruleReaches(parseShareRule(['Ana', 'Ben']), as(cara), people)).toBe(false);
    expect(ruleReaches(parseShareRule(['public', 'except Cara']), as(cara), people)).toBe(false);
    expect(ruleReaches(parseShareRule(['public', 'except Cara']), as(ben), people)).toBe(true);
    expect(ruleReaches(parseShareRule(['Ana', 'except Ana']), as(ana), people)).toBe(false);
    expect(ruleReaches(parseShareRule(['public', 'private']), as(ana), people)).toBe(false);
    expect(ruleReaches(parseShareRule(['public', 'except Zed']), as(ana), people)).toBe(false);
    expect(ruleReaches(parseShareRule('Annie'), as(ana), people)).toBe(true); // a former name still reaches her
    expect(ruleReaches(parseShareRule('Ana'), { tableId: 'U'.repeat(43), personId: 'ana' }, people)).toBe(false); // another table
    expect(unknownRuleNames(parseShareRule(['Ana', 'except Zed', 'Yan']), people)).toEqual(['Yan', 'Zed']);
  });

  it('writes what the dialog chose', () => {
    expect(formatShareRule({ everyone: true, people: [], except: [] })).toBe('public');
    expect(formatShareRule({ everyone: true, people: ['Ana'], except: ['Cara'] })).toEqual(['public', 'except Cara']);
    expect(formatShareRule({ everyone: false, people: ['Ana', 'Ben'], except: ['Cara'] })).toEqual(['Ana', 'Ben']);
    expect(formatShareRule({ everyone: false, people: [], except: [] })).toBeNull();
  });

  it('checks callouts: private never, only those, except all but those, unknown names fail closed', () => {
    expect(partAllows({ kind: 'private' }, as(ana), people)).toBe(false);
    expect(partAllows({ kind: 'only', names: ['Ana', 'Zed'] }, as(ana), people)).toBe(true);
    expect(partAllows({ kind: 'only', names: ['Zed'] }, as(ana), people)).toBe(false);
    expect(partAllows({ kind: 'except', names: ['Cara'] }, as(ana), people)).toBe(true);
    expect(partAllows({ kind: 'except', names: ['Cara'] }, as(cara), people)).toBe(false);
    expect(partAllows({ kind: 'except', names: ['Zed'] }, as(ana), people)).toBe(false);
  });

  it('reads the mapping entries YAML makes of `except Cara` and `only Ana` (I2)', () => {
    expect(parseShareRule(['public', { except: 'Cara' }])).toMatchObject({ public: true, except: ['Cara'], private: false });
    expect(parseShareRule([{ except: ['Cara', 'Ben'] }, { only: 'Ana' }])).toMatchObject({ except: ['Cara', 'Ben'], only: ['Ana'] });
    expect(parseShareRule([{ EXCEPT: 'Cara' }, 'public'])).toMatchObject({ except: ['Cara'] });
    expect(ruleReaches(parseShareRule(['public', { except: 'Cara' }]), as(cara), people)).toBe(false);
    expect(ruleReaches(parseShareRule({ except: 'Cara' }), as(ana), people)).toBe(false);
  });

  it('any other entry that is not a string makes the note private, and says so (I2)', () => {
    for (const value of [['public', 7], ['public', true], ['public', ['except Cara']], ['public', { except: 'Cara', other: 1 }], ['public', { colour: 'red' }], ['public', { except: 4 }], 5, true]) {
      const rule = parseShareRule(value);
      expect(rule, JSON.stringify(value)).toMatchObject({ private: true, unreadable: true });
      expect(ruleReaches(rule, as(ana), people)).toBe(false);
    }
    expect(parseShareRule(null)).toEqual({ private: false, public: false, only: [], except: [] });
    expect(parseShareRule(['public', { except: 'Cara' }])).not.toHaveProperty('unreadable');
  });

  it('reads `except:Cara` without a space, and refuses any other `word:` entry (R2-3)', () => {
    expect(parseShareRule(['public', 'except:Cara'])).toMatchObject({ public: true, except: ['Cara'], private: false });
    expect(parseShareRule(['ONLY:Ana', 'except:  Ben'])).toMatchObject({ only: ['Ana'], except: ['Ben'] });
    expect(ruleReaches(parseShareRule(['public', 'except:Cara']), as(cara), people)).toBe(false);
    for (const value of [['public', 'excpet:Cara'], ['public', 'except:'], 'colour:red']) {
      expect(parseShareRule(value), JSON.stringify(value)).toMatchObject({ private: true, unreadable: true });
    }
  });

  it('except excludes every person any of its names matches, current or former (I3)', () => {
    const newAna = person('ana2', 'Ana');
    const many = { byName: people.byName, allByName: (name: string): Person[] => [ana, newAna, ben].filter((p) => p.name === name || p.formerNames.includes(name)) };
    // Old Ana was renamed; a second entry now holds the same name.
    const renamed = person('ana', 'Ana Silva', { formerNames: ['Ana'] });
    const both = { byName: (name: string): Person | null => (name === 'Ana' ? newAna : name === 'Ana Silva' ? renamed : null), allByName: (name: string): Person[] => [renamed, newAna].filter((p) => p.name === name || p.formerNames.includes(name)) };
    expect(ruleReaches(parseShareRule(['public', 'except Ana']), as(renamed), both)).toBe(false);
    expect(ruleReaches(parseShareRule(['public', 'except Ana']), as(newAna), both)).toBe(false);
    expect(partAllows({ kind: 'except', names: ['Ana'] }, as(renamed), both)).toBe(false);
    expect(partAllows({ kind: 'except', names: ['Ana'] }, as(newAna), both)).toBe(false);
    expect(partAllows({ kind: 'except', names: ['Ana'] }, as(ben), both)).toBe(true);
    expect(many.allByName('Ana')).toHaveLength(2);
  });
});
