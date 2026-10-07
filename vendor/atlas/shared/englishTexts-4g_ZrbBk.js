const dice = {
  "dice.formulaError.syntax": "Use dice and numbers separated by + or −, such as 2d6+3. Dice must have 2–1,000 faces and numbers at most 4 digits.",
  "dice.formulaError.length": "A dice formula can have at most 64 characters.",
  "dice.formulaError.terms": "A dice formula can have at most 10 terms.",
  "dice.formulaError.dice": "A dice formula can roll at most 100 dice before explosions.",
  "dice.formulaError.faces": "Dice must have between 2 and 1,000 faces.",
  "dice.clearHistory": "Clear history",
  "dice.clearSelection": "Clear selection",
  "dice.closeHint": "Close (Enter or Esc)",
  "dice.details": "Details",
  "dice.log": "Dice Log",
  "dice.noRolls": "No rolls yet",
  "dice.pin": "Pin panel open",
  "dice.rollAgain": "Roll again",
  "dice.unknown": "Unknown",
  "dice.unpin": "Unpin panel",
  "dice.player": "Player",
  "dice.rollFormula": "Roll {formula}",
  /** The dice look setting: Atlas's own dice, or a look another plugin added (`dice.registerLook`). */
  /** The dice tray's colour picker (`dice.registerColours`). */
  "dice.colour.label": "Colour of the next dice",
  "dice.colour.none": "No colour",
  /** What the tray holds in one colour, e.g. "Fire: 2d6 + 1d20". */
  "dice.colour.group": "{name}: {dice}",
  "dice.look.name": "Dice look",
  "dice.look.desc": "Atlas's dice in the colour and numbers below, or a look another plugin added. A look's numbers that it has no art for use the numbers below.",
  "dice.look.atlas": "Atlas dice",
  /** A chosen look whose plugin is not loaded; `{id}` is the look's id. */
  "dice.look.notLoaded": "{id} (not loaded)",
  "dice.look.notLoadedHint": "The plugin that adds this look is not loaded, so Atlas's own dice show until it is.",
  /** A log entry that lists only some of a roll's dice; the total counts them all. */
  "dice.moreDice": "+{count} more"
};
const laser = {
  "laser.color.red": "Red",
  "laser.color.orange": "Orange",
  "laser.color.yellow": "Yellow",
  "laser.color.mint": "Mint",
  "laser.color.sky": "Sky blue",
  "laser.color.blue": "Blue",
  "laser.color.pink": "Pink",
  "laser.color.white": "White",
  "laser.colorHint": "Sky blue, blue and white stay clear for colour-blind players."
};
const mapIcon = {
  "mapIcon.doorOpen": "Open Door",
  "mapIcon.doorClosed": "Closed Door",
  "mapIcon.lock": "Locked",
  "mapIcon.key": "Key",
  "mapIcon.trap": "Trap",
  "mapIcon.danger": "Danger",
  "mapIcon.fire": "Fire",
  "mapIcon.loot": "Loot",
  "mapIcon.treasure": "Treasure",
  "mapIcon.combat": "Combat",
  "mapIcon.tracks": "Tracks",
  "mapIcon.blocked": "Blocked"
};
const token = {
  "token.unknownCreature": "Unknown Creature",
  "token.clickToName": "Click to name",
  "token.size.medium": "Medium (1×1)",
  "token.size.large": "Large (2×2)",
  "token.size.huge": "Huge (3×3)",
  "token.size.gargantuan": "Gargantuan (4×4)",
  "token.kill": "Kill",
  "token.show": "Show",
  "token.hide": "Hide",
  "token.saveEncounter": "Save as Encounter",
  "token.addInitiative": "Add to Initiative",
  "token.editStatblock": "Edit Statblock",
  "token.linkFailed": "Could not link the statblock",
  "token.ringColor": "Ring Color",
  "token.reset": "Reset (Full HP, Clear Status)"
};
const SHARED_ENGLISH = { ...dice, ...laser, ...mapIcon, ...token };
function t(key, values) {
  const message = SHARED_ENGLISH[key];
  const text = message === void 0 ? key : typeof message === "string" ? message : message.other;
  return text;
}
export {
  t
};
