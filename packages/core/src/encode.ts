/**
 * Writing text in the legacy encoding a file came in (SubRip files are often Windows-1252,
 * Shift_JIS and the like). Browsers only encode UTF-8, so the tables are built by decoding every
 * byte (and, for the East Asian encodings, every two-byte sequence) once.
 */

const tables = new Map<string, Map<string, number[]>>();

/** Encodings with two-byte sequences, and the lead and trail byte ranges to enumerate. */
const DOUBLE_BYTE: Record<string, [number, number, number, number]> = {
  shift_jis: [0x81, 0xfc, 0x40, 0xfc],
  'euc-jp': [0xa1, 0xfe, 0xa1, 0xfe],
  'euc-kr': [0x81, 0xfe, 0x41, 0xfe],
  gb18030: [0x81, 0xfe, 0x40, 0xfe],
  big5: [0x81, 0xfe, 0x40, 0xfe],
};

function table(encoding: string): Map<string, number[]> {
  let map = tables.get(encoding);
  if (map) return map;
  map = new Map();
  const decoder = new TextDecoder(encoding, { fatal: true });
  const add = (bytes: number[]): void => {
    let char: string;
    try {
      char = decoder.decode(new Uint8Array(bytes));
    } catch {
      return;
    }
    // One character, and the first (shortest) sequence for it.
    if ([...char].length === 1 && !map!.has(char)) map!.set(char, bytes);
  };
  for (let b = 0; b < 0x80; b++) add([b]);
  const double = DOUBLE_BYTE[encoding];
  if (double) {
    const [l0, l1, t0, t1] = double;
    for (let lead = l0; lead <= l1; lead++)
      for (let trail = t0; trail <= t1; trail++) add([lead, trail]);
    // Single bytes above ASCII (half-width katakana in Shift_JIS).
    for (let b = 0x80; b < 0x100; b++) add([b]);
  } else {
    for (let b = 0x80; b < 0x100; b++) add([b]);
  }
  tables.set(encoding, map);
  return map;
}

/**
 * `text` in `encoding`, or null when a character cannot be written in it (or the encoding is
 * not one this can write). UTF-8 and UTF-16 always succeed.
 */
export function encodeText(text: string, encoding: string): Uint8Array | null {
  const label = encoding.toLowerCase();
  if (label === 'utf-8') return new TextEncoder().encode(text);
  if (label === 'utf-16le' || label === 'utf-16be') {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const [a, b] = label === 'utf-16le' ? [code & 0xff, code >> 8] : [code >> 8, code & 0xff];
      out[i * 2] = a;
      out[i * 2 + 1] = b;
    }
    return out;
  }
  let map: Map<string, number[]>;
  try {
    map = table(label);
  } catch {
    return null; // An encoding the browser does not know.
  }
  const out: number[] = [];
  for (const char of text) {
    const bytes = map.get(char);
    if (!bytes) return null;
    out.push(...bytes);
  }
  const encoded = new Uint8Array(out);
  // Read back, so that a table mistake can never write the wrong text.
  return new TextDecoder(label).decode(encoded) === text ? encoded : null;
}
