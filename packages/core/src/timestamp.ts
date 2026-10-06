/**
 * WebVTT timestamps.
 *
 * Times are represented internally as integer milliseconds so that editing operations
 * (shift, split, snap) are exact. Conversion to the floating-point seconds used by the
 * VTTCue API happens only at that boundary.
 *
 * Spec: https://w3c.github.io/webvtt/#collect-a-webvtt-timestamp
 */

export type TimestampParseResult =
  { ok: true; ms: number; end: number } | { ok: false; end: number };

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;

function collectDigits(input: string, position: number): number {
  while (position < input.length && isDigit(input.charCodeAt(position))) position++;
  return position;
}

/**
 * Runs the "collect a WebVTT timestamp" algorithm on `input` starting at `position`.
 * `end` is the position after the characters consumed, whether or not parsing succeeded,
 * mirroring the spec's shared `position` variable.
 */
export function parseTimestamp(input: string, position = 0): TimestampParseResult {
  let hoursAreMostSignificant = false;
  let pos = position;

  if (pos >= input.length || !isDigit(input.charCodeAt(pos))) return { ok: false, end: pos };
  let next = collectDigits(input, pos);
  let s = input.slice(pos, next);
  let value1 = Number(s);
  pos = next;
  if (s.length !== 2 || value1 > 59) hoursAreMostSignificant = true;

  if (input.charCodeAt(pos) !== 0x3a) return { ok: false, end: pos };
  pos++;
  next = collectDigits(input, pos);
  s = input.slice(pos, next);
  pos = next;
  if (s.length !== 2) return { ok: false, end: pos };
  let value2 = Number(s);

  let value3: number;
  if (hoursAreMostSignificant || input.charCodeAt(pos) === 0x3a) {
    if (input.charCodeAt(pos) !== 0x3a) return { ok: false, end: pos };
    pos++;
    next = collectDigits(input, pos);
    s = input.slice(pos, next);
    pos = next;
    if (s.length !== 2) return { ok: false, end: pos };
    value3 = Number(s);
  } else {
    value3 = value2;
    value2 = value1;
    value1 = 0;
  }

  if (input.charCodeAt(pos) !== 0x2e) return { ok: false, end: pos };
  pos++;
  next = collectDigits(input, pos);
  s = input.slice(pos, next);
  pos = next;
  if (s.length !== 3) return { ok: false, end: pos };
  const value4 = Number(s);

  if (value2 > 59 || value3 > 59) return { ok: false, end: pos };

  return { ok: true, ms: ((value1 * 60 + value2) * 60 + value3) * 1000 + value4, end: pos };
}

/**
 * Serializes milliseconds as a conforming WebVTT timestamp. Hours are always emitted
 * (as at least two digits) unless `omitZeroHours` is set and the hours are zero.
 */
export function formatTimestamp(ms: number, omitZeroHours = false): string {
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new RangeError(`Invalid timestamp: ${ms}`);
  }
  const frac = ms % 1000;
  const totalSeconds = (ms - frac) / 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mmss = `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(frac, 3)}`;
  return omitZeroHours && hours === 0 ? mmss : `${pad(hours, 2)}:${mmss}`;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
