// The core targets plain ES2022 without DOM typings, but runs in browsers, Workers and Node,
// all of which provide the Encoding API. Declare just the part we use.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
