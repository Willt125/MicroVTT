/**
 * Input preprocessing for the WebVTT parser (spec §6.1).
 *
 * Bytes are decoded with the UTF-8 decode algorithm (which strips one leading BOM and replaces
 * invalid sequences with U+FFFD). The parser's input transformations are then applied:
 * U+0000 becomes U+FFFD, and CRLF / lone CR become LF. Both steps are streaming-safe: a chunk
 * boundary may split a UTF-8 sequence or a CRLF pair.
 */

/** Applies the parser's input transformations to successive chunks of decoded text. */
export class LineEndingNormalizer {
  private pendingCR = false;

  push(chunk: string): string {
    if (chunk === '') return '';
    let text = chunk;
    if (this.pendingCR && text.charCodeAt(0) === 0x0a) text = text.slice(1);
    this.pendingCR = text.charCodeAt(text.length - 1) === 0x0d;
    // eslint-disable-next-line no-control-regex
    return text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '\ufffd');
  }
}

/** Streaming UTF-8 decoder followed by the parser's input transformations. */
export class WebVTTDecoder {
  private readonly decoder = new TextDecoder('utf-8');
  private readonly normalizer = new LineEndingNormalizer();

  push(bytes: Uint8Array): string {
    return this.normalizer.push(this.decoder.decode(bytes, { stream: true }));
  }

  end(): string {
    return this.normalizer.push(this.decoder.decode());
  }
}

/** Applies the parser's input transformations to a complete string. */
export function normalizeInput(text: string): string {
  return new LineEndingNormalizer().push(text);
}

/** Encodings offered when a file is not UTF-8 (labels the Encoding Standard knows). */
export const FILE_ENCODINGS: readonly { label: string; name: string }[] = [
  { label: 'utf-8', name: 'UTF-8' },
  { label: 'windows-1252', name: 'Western (Windows-1252)' },
  { label: 'iso-8859-15', name: 'Western (ISO-8859-15)' },
  { label: 'windows-1250', name: 'Central European (Windows-1250)' },
  { label: 'windows-1251', name: 'Cyrillic (Windows-1251)' },
  { label: 'windows-1253', name: 'Greek (Windows-1253)' },
  { label: 'windows-1254', name: 'Turkish (Windows-1254)' },
  { label: 'windows-1255', name: 'Hebrew (Windows-1255)' },
  { label: 'windows-1256', name: 'Arabic (Windows-1256)' },
  { label: 'windows-874', name: 'Thai (Windows-874)' },
  { label: 'shift_jis', name: 'Japanese (Shift_JIS)' },
  { label: 'euc-kr', name: 'Korean (EUC-KR)' },
  { label: 'gb18030', name: 'Chinese, simplified (GB18030)' },
  { label: 'big5', name: 'Chinese, traditional (Big5)' },
  { label: 'utf-16le', name: 'UTF-16 (little-endian)' },
  { label: 'utf-16be', name: 'UTF-16 (big-endian)' },
];

/**
 * Decodes a file for import. WebVTT is UTF-8 only (§4.1), so that is tried first; a file that is
 * not valid UTF-8 (often an SRT file renamed, or one saved by an old Windows tool) is read as
 * Windows-1252 instead of having its non-ASCII letters turned into U+FFFD, and a UTF-16 byte
 * order mark is honoured. `encoding` forces one (the user's choice). `guessed` is true when the
 * encoding is not UTF-8 and was not asked for.
 */
export function decodeFile(
  bytes: Uint8Array,
  encoding?: string,
): { text: string; encoding: string; guessed: boolean } {
  if (encoding !== undefined) {
    return { text: new TextDecoder(encoding).decode(bytes), encoding, guessed: false };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le', guessed: true };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be', guessed: true };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf-8',
      guessed: false,
    };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
      guessed: true,
    };
  }
}
