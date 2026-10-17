/**
 * Keyboard shortcuts. Plain keys work when focus is not in a text field; the same keys with Alt
 * (Option) work everywhere, including while typing cue text. Alt shortcuts match the physical
 * key (`event.code`), because Option changes the character typed on macOS.
 */

export type Action =
  | 'play'
  | 'back'
  | 'forward'
  | 'back-long'
  | 'forward-long'
  | 'frame-back'
  | 'frame-forward'
  | 'set-start'
  | 'set-end'
  | 'to-pointer'
  | 'loop'
  | 'add'
  | 'split'
  | 'merge'
  | 'previous'
  | 'next'
  | 'help';

interface Shortcut {
  action: Action;
  /** `event.key` values for the plain form. */
  keys: string[];
  /** `event.code` for the Alt form; none for plain-only shortcuts. */
  code?: string;
  shift?: boolean;
  /** Shown in the help dialog. */
  label: string;
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    action: 'play',
    keys: [' ', 'k'],
    code: 'KeyK',
    label: 'Space or K',
    description: 'Play or pause',
  },
  { action: 'back', keys: ['j'], code: 'KeyJ', label: 'J', description: 'Back 1 second' },
  { action: 'forward', keys: ['l'], code: 'KeyL', label: 'L', description: 'Forward 1 second' },
  {
    action: 'back-long',
    keys: ['J'],
    code: 'KeyJ',
    shift: true,
    label: 'Shift+J',
    description: 'Back 5 seconds',
  },
  {
    action: 'forward-long',
    keys: ['L'],
    code: 'KeyL',
    shift: true,
    label: 'Shift+L',
    description: 'Forward 5 seconds',
  },
  {
    action: 'frame-back',
    keys: [','],
    code: 'Comma',
    label: ',',
    description: 'Back one frame (pauses)',
  },
  {
    action: 'frame-forward',
    keys: ['.'],
    code: 'Period',
    label: '.',
    description: 'Forward one frame (pauses)',
  },
  {
    action: 'set-start',
    keys: ['['],
    code: 'BracketLeft',
    label: '[',
    description: 'Set the cue’s start to the playhead',
  },
  {
    action: 'set-end',
    keys: [']'],
    code: 'BracketRight',
    label: ']',
    description: 'Set the cue’s end to the playhead',
  },
  {
    action: 'to-pointer',
    keys: ['p'],
    code: 'KeyP',
    label: 'P',
    description: 'Move the playhead to the mouse pointer on the timeline',
  },
  { action: 'loop', keys: ['r'], code: 'KeyR', label: 'R', description: 'Loop the cue on or off' },
  {
    action: 'add',
    keys: ['n'],
    code: 'KeyN',
    label: 'N',
    description: 'New cue (at the playhead when media is open)',
  },
  {
    action: 'split',
    keys: ['s'],
    code: 'KeyS',
    label: 'S',
    description: 'Split the cue (at the text cursor, and the playhead if inside the cue)',
  },
  {
    action: 'merge',
    keys: ['m'],
    code: 'KeyM',
    label: 'M',
    description: 'Merge the selected cues, or the cue with the next one',
  },
  {
    action: 'previous',
    keys: [],
    code: 'ArrowUp',
    label: 'Alt+↑ (↑ in the list)',
    description: 'Previous cue',
  },
  {
    action: 'next',
    keys: [],
    code: 'ArrowDown',
    label: 'Alt+↓ (↓ in the list)',
    description: 'Next cue',
  },
  { action: 'help', keys: ['?'], label: '?', description: 'Show keyboard shortcuts' },
];

/** The action for a key press, or null. `typing` is true when focus is in a text field. */
export function actionFor(event: KeyboardEvent, typing: boolean): Action | null {
  if (event.ctrlKey || event.metaKey) return null;
  for (const s of SHORTCUTS) {
    if (event.altKey) {
      if (s.code === event.code && !!s.shift === !!event.shiftKey) return s.action;
    } else if (!typing && s.keys.includes(event.key)) {
      return s.action;
    }
  }
  return null;
}
