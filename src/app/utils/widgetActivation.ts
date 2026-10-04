// Copied from Atlas VTT src/app/utils/widgetActivation.ts at c1d4d15 (AGPL-3.0-only).
import type { AnyWidget, WidgetSettings } from '../types/widgetTypes';

/** Whether the widget shows in its scene: not switched off there, nor hidden by an older Atlas version. */
export function isWidgetOn(settings: Pick<WidgetSettings, 'offWidgets'> | undefined, widget: AnyWidget): boolean {
  return widget.visible !== false && !settings?.offWidgets?.includes(widget.id);
}

/** The scene's switched-off widgets with `widgetId` added (`off`) or removed; undefined once none is off. */
export function withWidgetOff(offWidgets: readonly string[] | undefined, widgetId: string, off: boolean): string[] | undefined {
  const others = (offWidgets ?? []).filter((id) => id !== widgetId);
  const next = off ? [...others, widgetId] : others;
  return next.length > 0 ? next : undefined;
}
