import { r as rollFace, a as rollExplosions, M as MAX_EXPLOSIONS } from "./diceLabels-DiaA4yev.js";
import { d, b, e, c } from "./diceLabels-DiaA4yev.js";
import { D, a, b as b2, L, c as c2, d as d2, r } from "./laserPointerSettings-BMmA428j.js";
const DEFAULT_DICE_RULES = { defaultRoll: "1d20", crit: "natural" };
const CRIT_RULES = ["natural", "roll-under", "doubles", "high-total", "none"];
const EXPLODE_SCOPES = ["default", "all"];
const DEFAULT_EXPLODE_RULE = { dice: "all", repeats: true, highFaces: 1, lowFaces: 0 };
const MAX_EXPLODING_FACES = 99;
function isFaceCount(value, least) {
  return typeof value === "number" && Number.isInteger(value) && value >= least && value <= MAX_EXPLODING_FACES;
}
function parseExplodeRule(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const { dice, repeats, highFaces, lowFaces } = raw;
  if (!EXPLODE_SCOPES.includes(dice) || typeof repeats !== "boolean") return null;
  if (!isFaceCount(highFaces, 1) || !isFaceCount(lowFaces, 0)) return null;
  return { dice, repeats, highFaces, lowFaces };
}
function isValidDiceRules(dice) {
  return isValidDefaultRoll(dice.defaultRoll) && (dice.explode === void 0 || parseExplodeRule(dice.explode) !== null);
}
function withExplodeScope(dice, choice) {
  const { explode, ...rest } = dice;
  if (choice === "off") return rest;
  return { ...rest, explode: { ...explode ?? DEFAULT_EXPLODE_RULE, dice: choice } };
}
function sameExplodeRule(a2, b3) {
  if (!a2 || !b3) return a2 === b3;
  return a2.dice === b3.dice && a2.repeats === b3.repeats && a2.highFaces === b3.highFaces && a2.lowFaces === b3.lowFaces;
}
const DEFAULT_ROLL = /^([1-9]\d?)?d([2-9]|[1-9]\d{1,2})$/i;
function parseDefaultRoll(defaultRoll) {
  const match = DEFAULT_ROLL.exec(defaultRoll.trim());
  return match ? { count: Number(match[1] ?? "1"), sides: Number(match[2]) } : null;
}
function isValidDefaultRoll(value) {
  return parseDefaultRoll(value) !== null;
}
function collectionDiceRules(settings, presets) {
  var _a;
  return settings.dice ?? ((_a = presets.find((preset) => preset.id === settings.systemPresetId)) == null ? void 0 : _a.rules.dice) ?? { ...DEFAULT_DICE_RULES };
}
function sameDiceRules(a2, b3) {
  const left = a2 ?? DEFAULT_DICE_RULES;
  const right = b3 ?? DEFAULT_DICE_RULES;
  return left.defaultRoll.trim().toLowerCase() === right.defaultRoll.trim().toLowerCase() && left.crit === right.crit && sameExplodeRule(left.explode, right.explode);
}
function getDiceCrit(rolls, rules) {
  const roll = parseDefaultRoll(rules.defaultRoll);
  if (!roll || rules.crit === "none") return null;
  const values = rolls.filter((die) => !die.negative && !die.exploded && die.max === roll.sides).slice(0, roll.count).map((die) => die.value);
  if (values.length < roll.count) return null;
  switch (rules.crit) {
    case "natural":
      return extremeCrit(values, roll.sides, 1);
    case "roll-under":
      return extremeCrit(values, 1, roll.sides);
    case "doubles":
      return values.length >= 2 && values.every((value) => value === values[0]) ? "high" : null;
    case "high-total":
      return values.reduce((sum, value) => sum + value, 0) >= roll.count * roll.sides - 1 ? "high" : null;
  }
}
function extremeCrit(values, best, worst) {
  if (values.includes(best)) return "high";
  return values.includes(worst) ? "low" : null;
}
const TERM = /([+-]?)\s*(?:(\d*)d(\d+)(?:!{1,2}(i|\d+)?)?|(\d+))/gi;
function hasDiceTerm(formula) {
  return /\d*d\d+/i.test(formula);
}
function notedExplosion(times) {
  const limit = times === "i" ? MAX_EXPLOSIONS : Number(times ?? "1");
  return { highFaces: 1, lowFaces: 0, limit };
}
function ruledExplosion({ repeats, highFaces, lowFaces }) {
  return { highFaces, lowFaces, limit: repeats ? MAX_EXPLOSIONS : 1 };
}
function rollFormula$1(formula, random = Math.random, rules) {
  const rolls = [];
  let modifiers = 0;
  const explode = rules == null ? void 0 : rules.explode;
  const defaultRoll = (explode == null ? void 0 : explode.dice) === "default" ? parseDefaultRoll((rules == null ? void 0 : rules.defaultRoll) ?? "") : null;
  let defaultDiceLeft = (defaultRoll == null ? void 0 : defaultRoll.count) ?? 0;
  for (const [term, sign, count, sides, times, constant] of formula.matchAll(TERM)) {
    const factor = sign === "-" ? -1 : 1;
    if (constant !== void 0) {
      modifiers += factor * Number(constant);
      continue;
    }
    const faces = Number(sides);
    if (faces < 2) continue;
    const noted = term.includes("!") ? notedExplosion(times) : null;
    for (let i = 0; i < Number(count || "1"); i++) {
      const die = {
        die: `d${faces}`,
        value: rollFace(faces, random),
        max: faces,
        ...factor < 0 && { negative: true }
      };
      rolls.push(die);
      const isDefaultDie = factor > 0 && faces === (defaultRoll == null ? void 0 : defaultRoll.sides) && defaultDiceLeft > 0;
      if (isDefaultDie) defaultDiceLeft -= 1;
      const ruled = explode && (explode.dice === "all" || isDefaultDie) ? ruledExplosion(explode) : null;
      const explosion = noted ?? ruled;
      if (explosion) rolls.push(...rollExplosions(die, explosion, random));
    }
  }
  const dice = rolls.reduce((sum, die) => sum + (die.negative ? -die.value : die.value), 0);
  return { rolls, modifiers, total: dice + modifiers };
}
const DICE_TYPES = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
const DICE_ROLLED_EVENT = "atlas-dice-rolled";
function isDieType(value) {
  return typeof value === "string" && DICE_TYPES.includes(value);
}
function diceTerms(selection) {
  return Object.entries(selection).flatMap(([die, count]) => isDieType(die) && count !== void 0 && count > 0 ? [count > 1 ? `${count}${die}` : die] : []);
}
function diceFormula(selection, modifier = 0) {
  const dice = diceTerms(selection).join("+");
  if (!dice || modifier === 0) return dice;
  return `${dice}${modifier > 0 ? "+" : "-"}${Math.abs(modifier)}`;
}
function rollFormula(formula, random = Math.random, now = Date.now(), rules) {
  const { rolls, modifiers, total } = rollFormula$1(formula, random, rules);
  return {
    id: `roll_${now}_${Math.random().toString(36).slice(2, 11)}`,
    timestamp: now,
    formula,
    rolls,
    modifiers,
    total,
    ...rules && { crit: getDiceCrit(rolls, rules) },
    player: "Player"
  };
}
function withoutHiddenToken(result, isTokenHidden) {
  const source = result.source;
  const tokenId = source == null ? void 0 : source.tokenId;
  if (!source || !tokenId || !isTokenHidden(tokenId)) return result;
  const { type, abilityName } = source;
  return { ...result, source: abilityName ? { type, abilityName } : { type } };
}
function persistableDiceLog(log) {
  return log.filter((entry) => !entry.rolledBy);
}
function rollerName(result) {
  if (result.rolledBy) return result.rolledBy;
  const source = result.source;
  return (source == null ? void 0 : source.type) === "statblock" && source.tokenName ? source.tokenName : null;
}
function withDefaultRoll(modifier, defaultRoll) {
  const bonus = modifier.replace(/\s+/g, "");
  return bonus === "" || /^[+-]/.test(bonus) ? `${defaultRoll}${bonus}` : `${defaultRoll}+${bonus}`;
}
function rollByRules(formula, rules, random = Math.random, now = Date.now()) {
  return rollFormula(hasDiceTerm(formula) ? formula : withDefaultRoll(formula, rules.defaultRoll), random, now, rules);
}
const DEFAULT_INITIATIVE_RULES = { mode: "turn-order", roll: "1d20", firstSide: "players" };
const INITIATIVE_MODES = ["turn-order", "sides"];
const INITIATIVE_SIDES = ["players", "opponents"];
function parseInitiativeRules(raw) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const { mode, roll, firstSide } = raw;
  if (!INITIATIVE_MODES.includes(mode) || !INITIATIVE_SIDES.includes(firstSide)) return void 0;
  if (typeof roll !== "string" || !isValidDefaultRoll(roll)) return void 0;
  return { mode, roll: roll.trim(), firstSide };
}
function isValidInitiativeRules(rules) {
  return rules.mode !== "turn-order" || isValidDefaultRoll(rules.roll);
}
function savedInitiativeRules(rules) {
  return { ...rules, roll: isValidDefaultRoll(rules.roll) ? rules.roll.trim() : DEFAULT_INITIATIVE_RULES.roll };
}
function collectionInitiativeRules(settings, presets) {
  var _a;
  return parseInitiativeRules(settings.initiative) ?? ((_a = presets.find((preset) => preset.id === settings.systemPresetId)) == null ? void 0 : _a.rules.initiative) ?? { ...DEFAULT_INITIATIVE_RULES };
}
function sameInitiativeRules(a2, b3) {
  const left = a2 ?? DEFAULT_INITIATIVE_RULES;
  const right = b3 ?? DEFAULT_INITIATIVE_RULES;
  return left.mode === right.mode && left.firstSide === right.firstSide && left.roll.trim().toLowerCase() === right.roll.trim().toLowerCase();
}
const SIDE_LABELS = { players: "Players", opponents: "Opponents" };
function otherSide(side) {
  return side === "players" ? "opponents" : "players";
}
function sidesInOrder(first) {
  return [first, otherSide(first)];
}
function listedBySides(initiative, rules) {
  return initiative.isActive ? initiative.sides !== void 0 : rules.mode === "sides";
}
function sideOf(token) {
  var _a;
  if ((token == null ? void 0 : token.side) && INITIATIVE_SIDES.includes(token.side)) return token.side;
  return ((_a = token == null ? void 0 : token.vision) == null ? void 0 : _a.enabled) ? "players" : "opponents";
}
const MAX_RESOURCES = 6;
const BAR_SLOTS = 2;
function clampValue(value) {
  const max = Math.max(0, value.max);
  return { current: Math.max(0, Math.min(max, value.current)), max };
}
function withCurrent(value, current) {
  return clampValue({ current: Number.isFinite(current) ? current : value.current, max: value.max });
}
function startingValue(definition, max) {
  return { current: definition.direction === "fills" ? 0 : max, max };
}
function isSpent(definition, value) {
  if (value.max <= 0 || definition.direction === "static") return false;
  return definition.direction === "drains" ? value.current <= 0 : value.current >= value.max;
}
function isDefeated(token, definitions) {
  return definitions.some((definition) => {
    var _a;
    const value = (_a = token.resources) == null ? void 0 : _a[definition.key];
    return definition.defeatedWhenSpent === true && value !== void 0 && isSpent(definition, value);
  });
}
function isKillable(token, definitions) {
  return definitions.some((definition) => {
    var _a;
    return definition.defeatedWhenSpent === true && ((_a = token.resources) == null ? void 0 : _a[definition.key]) !== void 0;
  });
}
function resourceUpdate(token, key, next, maxEdited) {
  const resources = { ...token.resources, [key]: clampValue(next) };
  const overridden = token.overriddenMax ?? [];
  if (!maxEdited || overridden.includes(key)) return { resources };
  return { resources, overriddenMax: [...overridden, key] };
}
function mapDefined(token, definitions, change) {
  if (!token.resources) return void 0;
  const next = { ...token.resources };
  for (const definition of definitions) {
    const value = next[definition.key];
    if (value) next[definition.key] = change(definition, value);
  }
  return next;
}
function defeatedResources(token, definitions) {
  return mapDefined(token, definitions, (definition, value) => definition.defeatedWhenSpent ? { current: definition.direction === "drains" ? 0 : value.max, max: value.max } : value);
}
function restedResources(token, definitions) {
  return mapDefined(token, definitions, (definition, value) => startingValue(definition, value.max));
}
const FIRST_BARS = ["hp", "stress"];
function resetLabel(definitions) {
  const onlyFirstBars = definitions.every(({ key }) => FIRST_BARS.includes(key));
  return onlyFirstBars ? "Reset (Full HP, Clear Status)" : "Reset (Restore Resources, Clear Status)";
}
function isSocket(slot) {
  return typeof slot === "number" && Number.isInteger(slot) && slot >= 0 && slot < MAX_RESOURCES;
}
function slottedResources(definitions) {
  const sockets = /* @__PURE__ */ new Map();
  const waiting = [];
  for (const definition of definitions) {
    if (isSocket(definition.slot) && !sockets.has(definition.slot)) sockets.set(definition.slot, definition);
    else waiting.push(definition);
  }
  for (let slot = 0; slot < MAX_RESOURCES && waiting.length > 0; slot++) {
    if (!sockets.has(slot)) sockets.set(slot, waiting.shift());
  }
  return [...sockets].sort(([a2], [b3]) => a2 - b3).map(([slot, definition]) => ({ definition, slot }));
}
function shapeOf(slot) {
  return slot < BAR_SLOTS ? "bar" : "wheel";
}
function visibleResources(token, definitions, viewer) {
  var _a;
  const shown = [];
  for (const { definition, slot } of slottedResources(definitions)) {
    if (viewer === "player" && !definition.visibleToPlayers) continue;
    const value = (_a = token.resources) == null ? void 0 : _a[definition.key];
    if (!value || !(value.max > 0)) continue;
    shown.push({ definition, value, slot });
  }
  return shown;
}
const WARN_BELOW = 0.7;
const CRITICAL_BELOW = 0.3;
const WARN_COLOR = "#eab308";
const CRITICAL_COLOR = "#ef4444";
function remainingShare(definition, value) {
  if (!(value.max > 0)) return 0;
  const share = Math.max(0, Math.min(1, value.current / value.max));
  return definition.direction === "drains" ? share : 1 - share;
}
function resourceColor(definition, value) {
  if (!definition.defeatedWhenSpent) return definition.color;
  const left = remainingShare(definition, value);
  if (left >= WARN_BELOW) return definition.color;
  return left >= CRITICAL_BELOW ? WARN_COLOR : CRITICAL_COLOR;
}
const RESOURCE_COLORS = [
  { value: "#dc2626", label: "Red" },
  { value: "#f43f5e", label: "Rose" },
  { value: "#ec4899", label: "Pink" },
  { value: "#d946ef", label: "Fuchsia" },
  { value: "#a855f7", label: "Purple" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#0ea5e9", label: "Sky" },
  { value: "#06b6d4", label: "Cyan" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#10b981", label: "Emerald" },
  { value: "#22c55e", label: "Green" },
  { value: "#84cc16", label: "Lime" },
  { value: "#facc15", label: "Yellow" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#f97316", label: "Orange" },
  { value: "#b45309", label: "Brown" },
  { value: "#94a3b8", label: "Steel" },
  { value: "#e5e7eb", label: "White" }
];
const TRAY_DICE = [4, 6, 8, 10, 12, 20, 100];
const MAX_PER_DIE = 20;
const MAX_DICE = 100;
const MAX_MODIFIER = 20;
function trayFormula(pool, modifier) {
  const terms = TRAY_DICE.filter((sides) => (pool[sides] ?? 0) > 0).map((sides) => `${pool[sides]}d${sides}`);
  if (terms.length === 0) return "";
  const dice = terms.join(" + ");
  if (modifier === 0) return dice;
  return `${dice} ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`;
}
function trayDiceCount(pool) {
  return TRAY_DICE.reduce((sum, sides) => sum + (pool[sides] ?? 0), 0);
}
function addDie(pool, sides) {
  const count = pool[sides] ?? 0;
  if (count >= MAX_PER_DIE || trayDiceCount(pool) >= MAX_DICE) return pool;
  return { ...pool, [sides]: count + 1 };
}
function removeDie(pool, sides) {
  const count = pool[sides] ?? 0;
  return count > 0 ? { ...pool, [sides]: count - 1 } : pool;
}
function clampModifier(modifier) {
  return Math.max(-MAX_MODIFIER, Math.min(MAX_MODIFIER, modifier));
}
function trayPoolByDie(pool) {
  return Object.fromEntries(TRAY_DICE.filter((sides) => (pool[sides] ?? 0) > 0).map((sides) => [`d${sides}`, pool[sides] ?? 0]));
}
const PLAYER_VIEW_RULE_KEYS = ["showGrid", "showTokenNameplates", "showWidgets", "showInitiative"];
export {
  BAR_SLOTS,
  CRIT_RULES,
  DEFAULT_DICE_RULES,
  DEFAULT_EXPLODE_RULE,
  DEFAULT_INITIATIVE_RULES,
  D as DEFAULT_LASER_POINTER_SETTINGS,
  DICE_ROLLED_EVENT,
  DICE_TYPES,
  EXPLODE_SCOPES,
  INITIATIVE_MODES,
  INITIATIVE_SIDES,
  a as LASER_COLOR_HINT,
  b2 as LASER_COLOR_SWATCHES,
  L as LASER_FADE_TIME,
  c2 as LASER_SIZE_MAX,
  d2 as LASER_SIZE_MIN,
  MAX_DICE,
  MAX_EXPLODING_FACES,
  MAX_EXPLOSIONS,
  MAX_MODIFIER,
  MAX_PER_DIE,
  MAX_RESOURCES,
  PLAYER_VIEW_RULE_KEYS,
  RESOURCE_COLORS,
  SIDE_LABELS,
  TRAY_DICE,
  addDie,
  clampModifier,
  clampValue,
  collectionDiceRules,
  collectionInitiativeRules,
  defeatedResources,
  diceFormula,
  d as diceSum,
  diceTerms,
  b as dieLabel,
  e as explodes,
  c as explodingFaces,
  getDiceCrit,
  hasDiceTerm,
  isDefeated,
  isDieType,
  isFaceCount,
  isKillable,
  isSpent,
  isValidDefaultRoll,
  isValidDiceRules,
  isValidInitiativeRules,
  listedBySides,
  otherSide,
  parseDefaultRoll,
  parseExplodeRule,
  parseInitiativeRules,
  persistableDiceLog,
  remainingShare,
  removeDie,
  resetLabel,
  r as resolveLaserPointerSettings,
  resourceColor,
  resourceUpdate,
  restedResources,
  rollByRules,
  rollExplosions,
  rollFace,
  rollFormula,
  rollerName,
  sameDiceRules,
  sameInitiativeRules,
  savedInitiativeRules,
  shapeOf,
  sideOf,
  sidesInOrder,
  startingValue,
  trayDiceCount,
  trayFormula,
  trayPoolByDie,
  visibleResources,
  withCurrent,
  withExplodeScope,
  withoutHiddenToken
};
