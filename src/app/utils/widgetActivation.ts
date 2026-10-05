// Modified from Atlas VTT src/app/utils/widgetActivation.ts at c1d4d15 (AGPL-3.0-only); changes: dropped withWidgetOff, which Connect does not use.
import type { AnyWidget, WidgetSettings } from '../types/widgetTypes';

/** Whether the widget shows in its scene: not switched off there, nor hidden by an older Atlas version. */
export function isWidgetOn(settings: Pick<WidgetSettings, 'offWidgets'> | undefined, widget: AnyWidget): boolean {
  return widget.visible !== false && !settings?.offWidgets?.includes(widget.id);
}
