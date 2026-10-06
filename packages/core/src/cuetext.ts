/**
 * WebVTT cue text parsing (spec §6.4) and chapter title extraction (§6.6).
 *
 * Produces a tree of WebVTT Node Objects. The tree is DOM-free; the web app maps it to DOM
 * nodes following §6.5 ("cue text DOM construction rules").
 */
import { consumeCharacterReference } from './charref.ts';
import { parseTimestamp } from './timestamp.ts';

export type CueSpanType = 'c' | 'i' | 'b' | 'u' | 'ruby' | 'rt' | 'v' | 'lang';

export interface CueTextNode {
  type: 'text';
  value: string;
}

export interface CueTimestampNode {
  type: 'timestamp';
  /** Time in integer milliseconds. */
  ms: number;
}

export interface CueSpanNode {
  type: CueSpanType;
  /** Applicable classes, in source order, with empty strings removed. */
  classes: string[];
  /** Applicable language: the top of the language stack when the node was attached. */
  language: string | undefined;
  /** Voice name for `v`; unused (empty) for other spans. */
  annotation: string;
  children: CueNode[];
}

export interface CueRootNode {
  type: 'root';
  language: string | undefined;
  children: CueNode[];
}

export type CueNode = CueTextNode | CueTimestampNode | CueSpanNode;
export type CueInternalNode = CueRootNode | CueSpanNode;

const SPAN_TYPES: ReadonlySet<string> = new Set(['c', 'i', 'b', 'u', 'ruby', 'v', 'lang']);

/** Tokenizer states (plain constants rather than an enum, so the source is erasable TypeScript). */
const State = {
  Data: 0,
  Tag: 1,
  StartTag: 2,
  StartTagClass: 3,
  StartTagAnnotation: 4,
  EndTag: 5,
  TimestampTag: 6,
} as const;
type State = (typeof State)[keyof typeof State];

type Token =
  | { kind: 'string'; value: string }
  | { kind: 'start'; name: string; classes: string[]; annotation: string | undefined }
  | { kind: 'end'; name: string }
  | { kind: 'timestamp'; value: string };

const isAsciiWhitespace = (c: number): boolean =>
  c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;

function normalizeAnnotation(buffer: string): string {
  let start = 0;
  let end = buffer.length;
  while (start < end && isAsciiWhitespace(buffer.charCodeAt(start))) start++;
  while (end > start && isAsciiWhitespace(buffer.charCodeAt(end - 1))) end--;
  return buffer.slice(start, end).replace(/[\t\n\f\r ]+/g, ' ');
}

/** The WebVTT cue text tokenizer. Returns the token and the position after it. */
function nextToken(input: string, position: number): [Token, number] {
  let state: State = State.Data;
  let result = '';
  let buffer = '';
  const classes: string[] = [];
  let pos = position;

  for (;;) {
    const c = pos < input.length ? input.charCodeAt(pos) : -1;
    switch (state) {
      case State.Data:
        if (c === 0x26) {
          const ref = consumeCharacterReference(input, pos + 1);
          if (ref) {
            result += ref.value;
            pos = ref.end;
          } else {
            result += '&';
            pos++;
          }
          continue;
        }
        if (c === 0x3c) {
          if (result === '') {
            state = State.Tag;
            break;
          }
          return [{ kind: 'string', value: result }, pos];
        }
        if (c === -1) return [{ kind: 'string', value: result }, pos];
        result += input[pos];
        break;

      case State.Tag:
        if (c === 0x09 || c === 0x0a || c === 0x0c || c === 0x20) {
          state = State.StartTagAnnotation;
        } else if (c === 0x2e) {
          state = State.StartTagClass;
        } else if (c === 0x2f) {
          state = State.EndTag;
        } else if (c >= 0x30 && c <= 0x39) {
          result = input[pos] as string;
          state = State.TimestampTag;
        } else if (c === 0x3e) {
          return [{ kind: 'start', name: '', classes: [], annotation: undefined }, pos + 1];
        } else if (c === -1) {
          return [{ kind: 'start', name: '', classes: [], annotation: undefined }, pos];
        } else {
          result = input[pos] as string;
          state = State.StartTag;
        }
        break;

      case State.StartTag:
        if (c === 0x09 || c === 0x0c || c === 0x20) {
          state = State.StartTagAnnotation;
        } else if (c === 0x0a) {
          buffer = '\n';
          state = State.StartTagAnnotation;
        } else if (c === 0x2e) {
          state = State.StartTagClass;
        } else if (c === 0x3e || c === -1) {
          return [
            { kind: 'start', name: result, classes: [], annotation: undefined },
            c === -1 ? pos : pos + 1,
          ];
        } else {
          result += input[pos];
        }
        break;

      case State.StartTagClass:
        if (c === 0x09 || c === 0x0c || c === 0x20) {
          classes.push(buffer);
          buffer = '';
          state = State.StartTagAnnotation;
        } else if (c === 0x0a) {
          classes.push(buffer);
          buffer = '\n';
          state = State.StartTagAnnotation;
        } else if (c === 0x2e) {
          classes.push(buffer);
          buffer = '';
        } else if (c === 0x3e || c === -1) {
          classes.push(buffer);
          return [
            { kind: 'start', name: result, classes, annotation: undefined },
            c === -1 ? pos : pos + 1,
          ];
        } else {
          buffer += input[pos];
        }
        break;

      case State.StartTagAnnotation:
        if (c === 0x26) {
          const ref = consumeCharacterReference(input, pos + 1, 0x3e);
          if (ref) {
            buffer += ref.value;
            pos = ref.end;
          } else {
            buffer += '&';
            pos++;
          }
          continue;
        }
        if (c === 0x3e || c === -1) {
          return [
            { kind: 'start', name: result, classes, annotation: normalizeAnnotation(buffer) },
            c === -1 ? pos : pos + 1,
          ];
        }
        buffer += input[pos];
        break;

      case State.EndTag:
        if (c === 0x3e || c === -1) {
          return [{ kind: 'end', name: result }, c === -1 ? pos : pos + 1];
        }
        result += input[pos];
        break;

      case State.TimestampTag:
        if (c === 0x3e || c === -1) {
          return [{ kind: 'timestamp', value: result }, c === -1 ? pos : pos + 1];
        }
        result += input[pos];
        break;
    }
    pos++;
  }
}

/**
 * Runs the WebVTT cue text parsing rules on `input`, with an optional fallback `language`.
 */
export function parseCueText(input: string, language?: string): CueRootNode {
  const root: CueRootNode = { type: 'root', language, children: [] };
  const languageStack: string[] = language === undefined ? [] : [language];
  // `current` is the last element of `path`; its predecessor is the parent.
  const path: CueInternalNode[] = [root];
  let position = 0;

  const current = (): CueInternalNode => path[path.length - 1] as CueInternalNode;
  const attach = (type: CueSpanType, classes: string[], annotation = ''): void => {
    const node: CueSpanNode = {
      type,
      classes: classes.filter((cls) => cls !== ''),
      language: languageStack[languageStack.length - 1],
      annotation,
      children: [],
    };
    current().children.push(node);
    path.push(node);
  };

  while (position < input.length) {
    const [token, next] = nextToken(input, position);
    position = next;
    switch (token.kind) {
      case 'string':
        current().children.push({ type: 'text', value: token.value });
        break;
      case 'start':
        if (token.name === 'rt') {
          if (current().type === 'ruby') attach('rt', token.classes);
        } else if (token.name === 'lang') {
          languageStack.push(token.annotation ?? '');
          attach('lang', token.classes);
        } else if (token.name === 'v') {
          attach('v', token.classes, token.annotation ?? '');
        } else if (SPAN_TYPES.has(token.name)) {
          attach(token.name as CueSpanType, token.classes);
        }
        break;
      case 'end': {
        const type = current().type;
        if (token.name === type && type !== 'root' && type !== 'lang') {
          path.pop();
        } else if (token.name === 'lang' && type === 'lang') {
          path.pop();
          languageStack.pop();
        } else if (token.name === 'ruby' && type === 'rt') {
          path.pop();
          path.pop();
        }
        break;
      }
      case 'timestamp': {
        const ts = parseTimestamp(token.value);
        if (ts.ok && ts.end === token.value.length) {
          current().children.push({ type: 'timestamp', ms: ts.ms });
        }
        break;
      }
    }
  }
  return root;
}

/**
 * WebVTT rules for extracting the chapter title: the concatenated text in pre-order, skipping
 * ruby text and its descendants.
 */
export function extractChapterTitle(cueText: string): string {
  let title = '';
  const visit = (nodes: CueNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') title += node.value;
      else if (node.type !== 'timestamp' && node.type !== 'rt') visit(node.children);
    }
  };
  visit(parseCueText(cueText).children);
  return title;
}
