export declare const dice: {
    readonly 'dice.formulaError.syntax': "Use dice and numbers separated by + or −, such as 2d6+3. Dice must have 2–1,000 faces and numbers at most 4 digits.";
    readonly 'dice.formulaError.length': "A dice formula can have at most 64 characters.";
    readonly 'dice.formulaError.terms': "A dice formula can have at most 10 terms.";
    readonly 'dice.formulaError.dice': "A dice formula can roll at most 100 dice before explosions.";
    readonly 'dice.formulaError.faces': "Dice must have between 2 and 1,000 faces.";
    readonly 'dice.clearHistory': "Clear history";
    readonly 'dice.clearSelection': "Clear selection";
    readonly 'dice.closeHint': "Close (Enter or Esc)";
    readonly 'dice.details': "Details";
    readonly 'dice.log': "Dice Log";
    readonly 'dice.noRolls': "No rolls yet";
    readonly 'dice.pin': "Pin panel open";
    readonly 'dice.rollAgain': "Roll again";
    readonly 'dice.unknown': "Unknown";
    readonly 'dice.unpin': "Unpin panel";
    readonly 'dice.player': "Player";
    readonly 'dice.rollFormula': "Roll {formula}";
    /** The dice look setting: Atlas's own dice, or a look another plugin added (`dice.registerLook`). */
    readonly 'dice.look.name': "Dice look";
    readonly 'dice.look.desc': "Atlas's dice in the colour and numbers below, or a look another plugin added. A look's numbers that it has no art for use the numbers below.";
    readonly 'dice.look.atlas': "Atlas dice";
    /** A chosen look whose plugin is not loaded; `{id}` is the look's id. */
    readonly 'dice.look.notLoaded': "{id} (not loaded)";
    readonly 'dice.look.notLoadedHint': "The plugin that adds this look is not loaded, so Atlas's own dice show until it is.";
    /** A log entry that lists only some of a roll's dice; the total counts them all. */
    readonly 'dice.moreDice': "+{count} more";
};
