// online-client/icons.mts
/** Atlas's icons on the join page, drawn as CSS mask images (`.tool-icon` in `style.css`) in the text colour. */
export function iconElement(url: string): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = 'tool-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.style.setProperty('--icon', url);
  return icon;
}

/** Shows `url` in the icon inside `owner`, a button or menu entry. */
export function setIcon(owner: HTMLElement, url: string): void {
  owner.querySelector<HTMLElement>('.tool-icon')?.style.setProperty('--icon', url);
}
