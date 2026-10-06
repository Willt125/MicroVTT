/** Time entry for the editor: what users type into start/end fields. */
import { formatTimestamp } from '@microvtt/core';

/**
 * Parses a time typed by a user. Accepts WebVTT timestamps and looser forms:
 * "01:02:03.456", "2:03.4", "83.5" (seconds), "1:5" (m:s). Returns whole milliseconds, or null.
 */
export function parseTimeInput(input: string): number | null {
  const s = input.trim().replace(',', '.');
  const m = /^(?:(?:(\d+):)?(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const [, h = '0', min = '0', sec = '0', frac = ''] = m;
  const minutes = Number(min);
  const seconds = Number(sec);
  // Minutes and seconds may only overflow when they are the most significant part given.
  if (m[1] !== undefined && minutes > 59) return null;
  if (m[2] !== undefined && seconds > 59) return null;
  const ms = Number(frac.padEnd(3, '0'));
  const total = ((Number(h) * 60 + minutes) * 60 + seconds) * 1000 + ms;
  return Number.isSafeInteger(total) ? total : null;
}

export const formatTime = (ms: number): string => formatTimestamp(ms);

/** "1.234 s" style duration. */
export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(3)} s`;
}
