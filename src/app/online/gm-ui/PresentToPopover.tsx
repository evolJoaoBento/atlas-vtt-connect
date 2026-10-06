import React from 'react';
import { Button } from '../../ui/primitives/Button';
import { NO_PLAYERS_ROW } from '../split/splitCopy';
import type { PresentToMenu } from './presentToRows';

/** Where the popover is drawn, in the window's coordinates (`position: fixed`), and how tall it may grow. */
export interface PopoverPlace { top: number; left: number; maxHeight: number }

interface PresentToPopoverProps {
  ref: React.Ref<HTMLDivElement>;
  id: string;
  menu: PresentToMenu;
  /** Null until it is measured: drawn hidden once, then placed. */
  place: PopoverPlace | null;
  onMouseEnter: () => void;
  onMouseLeave: (event: React.MouseEvent) => void;
}

/**
 * The "Present to:" checklist (spec 3.2): the heading, one checkbox per player, then "Everyone back". Connect's own
 * React list, not an Obsidian `Menu`, which closes on every pick (D11): the GM ticks several players in a row.
 */
export function PresentToPopover({ ref, id, menu, place, onMouseEnter, onMouseLeave }: PresentToPopoverProps): React.ReactElement {
  const style: React.CSSProperties = place
    ? { top: place.top, left: place.left, maxHeight: place.maxHeight }
    : { top: 0, left: 0, visibility: 'hidden' };
  return (
    <div
      ref={ref}
      id={id}
      className="atlas-connect-present-to__popover"
      role="group"
      aria-label={menu.heading}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <p className="atlas-connect-present-to__heading">{menu.heading}</p>
      {menu.capNote && <p className="atlas-connect-present-to__note">{menu.capNote}</p>}
      {menu.rows.length === 0 ? (
        <label className="atlas-connect-present-to__row is-disabled">
          <input type="checkbox" checked={false} disabled readOnly />
          {NO_PLAYERS_ROW}
        </label>
      ) : (
        menu.rows.map((row) => (
          <label key={row.playerId} className={`atlas-connect-present-to__row${row.disabled ? ' is-disabled' : ''}`}>
            <input type="checkbox" checked={row.checked} disabled={row.disabled} onChange={() => row.choose()} />
            {row.label}
          </label>
        ))
      )}
      <div className="atlas-connect-present-to__separator" role="separator" />
      <Button size="sm" disabled={menu.everyoneBack.disabled} onClick={() => menu.everyoneBack.choose()}>{menu.everyoneBack.label}</Button>
    </div>
  );
}
