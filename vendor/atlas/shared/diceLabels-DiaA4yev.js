const MAX_EXPLOSIONS = 10;
function rollFace(sides, random) {
  return Math.floor(random() * sides) + 1;
}
function explodingFaces(sides, highFaces, lowFaces) {
  const high = Math.max(0, Math.min(highFaces, sides - 1));
  return { high, low: Math.max(0, Math.min(lowFaces, sides - 1 - high)) };
}
function rollExplosions(die, explosion, random = Math.random) {
  const { high, low } = explodingFaces(die.max, explosion.highFaces, explosion.lowFaces);
  const isHigh = (value2) => value2 > die.max - high;
  const up = isHigh(die.value);
  if (!up && die.value > low) return [];
  const negative = up === (die.negative === true);
  const extra = [];
  const limit = Math.min(explosion.limit, MAX_EXPLOSIONS);
  let value = die.value;
  while (extra.length < limit && (extra.length === 0 || isHigh(value))) {
    value = rollFace(die.max, random);
    extra.push({ die: die.die, value, max: die.max, exploded: true, ...negative && { negative: true } });
  }
  return extra;
}
function explodes(rolls, index) {
  var _a;
  return ((_a = rolls[index + 1]) == null ? void 0 : _a.exploded) === true;
}
function dieValue(rolls, index) {
  return `${rolls[index].value}${explodes(rolls, index) ? "!" : ""}`;
}
function diceSum(rolls) {
  return rolls.map((roll, i) => {
    const value = dieValue(rolls, i);
    if (i === 0) return roll.negative ? `−${value}` : value;
    return roll.negative ? ` − ${value}` : ` + ${value}`;
  }).join("");
}
function dieLabel(rolls, index) {
  const roll = rolls[index];
  return `${roll.negative && roll.exploded ? "−" : ""}${roll.die}: ${dieValue(rolls, index)}`;
}
export {
  MAX_EXPLOSIONS as M,
  rollExplosions as a,
  dieLabel as b,
  explodingFaces as c,
  diceSum as d,
  explodes as e,
  rollFace as r
};
