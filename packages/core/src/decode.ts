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
