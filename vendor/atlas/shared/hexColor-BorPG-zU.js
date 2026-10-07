const HEX_COLOR = /^#[0-9a-f]{6}$/i;
function isHexColor(value) {
  return typeof value === "string" && HEX_COLOR.test(value);
}
export {
  isHexColor as i
};
