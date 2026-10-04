// Copied from Atlas VTT src/app/utils/timerWidget.ts at c1d4d15 (AGPL-3.0-only).
export const DEFAULT_TIMER_COLOR = '#4caf50';

/** Formats seconds as MM:SS, or H:MM:SS from an hour up. */
export function formatTimerTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
