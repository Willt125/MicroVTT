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

const LEGACY_TIMESTAMP = /^([0-9]+):([0-9]{1,2})(?::([0-9]{1,2}))?(?:[.,]([0-9]+))?/;

/**
 * Reads a timestamp in the forms other tools write and parsers reject: a comma as the decimal
 * separator (SRT), one-digit minute or second fields, and any number of fraction digits
 * (rounded to the millisecond), or none. Two fields are minutes and seconds; three are hours,
 * minutes and seconds. Minutes and seconds must still be below 60. For import only: the
 * parser uses it, when asked, after `parseTimestamp` has failed.
 */
export function parseLegacyTimestamp(input: string, position = 0): TimestampParseResult {
  const m = LEGACY_TIMESTAMP.exec(input.slice(position));
  if (!m) return { ok: false, end: position };
  const end = position + m[0].length;
  // Not followed by more of a timestamp (e.g. a fourth field), which would be a misreading.
  if (/^[0-9:.,]/.test(input.slice(end))) return { ok: false, end };
  const [h, mm, ss] = m[3] === undefined ? ['0', m[1], m[2]] : [m[1], m[2], m[3]];
  const hours = Number(h);
  const minutes = Number(mm);
  const seconds = Number(ss);
  if (minutes > 59 || seconds > 59) return { ok: false, end };
  const fraction = m[4] ?? '';
  const ms =
    fraction.length <= 3
      ? Number(fraction.padEnd(3, '0'))
      : Number(fraction.slice(0, 3)) + (Number(fraction.charAt(3)) >= 5 ? 1 : 0);
  return { ok: true, ms: ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms, end };
}

/**
 * Serializes milliseconds as a conforming WebVTT timestamp. Hours are always emitted
 * (as at least two digits) unless `omitZeroHours` is set and the hours are zero.
 *
 * The syntax puts no upper bound on hours, so absurdly large (but integral) values are accepted
 * and formatted exactly via BigInt rather than rejected.
 */
export function formatTimestamp(ms: number, omitZeroHours = false): string {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new RangeError(`Invalid timestamp: ${ms}`);
  }
  let hours: string;
  let rest: number; // Milliseconds within the hour.
  if (Number.isSafeInteger(ms)) {
    hours = String(Math.floor(ms / 3_600_000));
    rest = ms % 3_600_000;
  } else {
    const total = BigInt(ms);
    hours = String(total / 3_600_000n);
    rest = Number(total % 3_600_000n);
  }
  const mmss = `${pad(Math.floor(rest / 60_000), 2)}:${pad(Math.floor(rest / 1000) % 60, 2)}.${pad(rest % 1000, 3)}`;
  return omitZeroHours && hours === '0' ? mmss : `${hours.padStart(2, '0')}:${mmss}`;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
