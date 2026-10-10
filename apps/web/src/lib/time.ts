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

/** A time with an optional sign ("-1.5", "+0:02.250"), for shifting; whole ms or null. */
export function parseSignedTime(input: string): number | null {
  const m = /^\s*([+−-]?)\s*(.*)$/.exec(input) as RegExpExecArray;
  const ms = parseTimeInput(m[2] as string);
  if (ms === null) return null;
  return m[1] === '-' || m[1] === '−' ? -ms : ms;
}

/** "+1.500 s" or "−0.040 s": a signed duration. */
export function formatShift(ms: number): string {
  return `${ms < 0 ? '−' : '+'}${formatDuration(Math.abs(ms))}`;
}
