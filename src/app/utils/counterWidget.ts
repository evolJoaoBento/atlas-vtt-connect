// Modified from Atlas VTT src/app/utils/counterWidget.ts at c1d4d15 (AGPL-3.0-only); changes: dropped stepCounter, clampCounterValue, DEFAULT_COUNTER_COLOR and the storeFactory type import.
import type { AnyWidget, SteppedWidget } from '../types/widgetTypes';

/** Counters and clocks: widgets stepped by hand, whose value lives in `widgetValues`. */
export function isSteppedWidget(widget: AnyWidget): widget is SteppedWidget {
  return widget.type === 'counter' || widget.type === 'clock';
}

/** Current value of a counter or clock: the undo-tracked `widgetValues` entry wins over the definition's copy. */
export function readCounterValue(state: { widgetValues?: Readonly<Record<string, number>> | undefined }, widget: SteppedWidget): number {
  const value = state.widgetValues?.[widget.id] ?? widget.value;
  return typeof value === 'number' ? value : 0;
}
