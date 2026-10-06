import { describe, expect, it } from 'vitest';
import { actionFor } from './shortcuts.ts';

const key = (init: KeyboardEventInit): KeyboardEvent => init as unknown as KeyboardEvent;

describe('shortcuts', () => {
  it('matches plain keys only outside text fields', () => {
    expect(actionFor(key({ key: ' ', code: 'Space' }), false)).toBe('play');
    expect(actionFor(key({ key: ' ', code: 'Space' }), true)).toBeNull();
    expect(actionFor(key({ key: 'J', code: 'KeyJ', shiftKey: true }), false)).toBe('back-long');
    expect(actionFor(key({ key: '[', code: 'BracketLeft' }), false)).toBe('set-start');
  });

  it('matches Alt shortcuts by physical key, even while typing', () => {
    // Option+S types "ß" on a Mac; the code still identifies the key.
    expect(actionFor(key({ key: 'ß', code: 'KeyS', altKey: true }), true)).toBe('split');
    expect(actionFor(key({ key: 'Ó', code: 'KeyJ', altKey: true, shiftKey: true }), true)).toBe(
      'back-long',
    );
    expect(actionFor(key({ key: 'ArrowDown', code: 'ArrowDown', altKey: true }), true)).toBe(
      'next',
    );
    expect(actionFor(key({ key: 'ArrowDown', code: 'ArrowDown' }), false)).toBeNull();
  });

  it('leaves Ctrl/Cmd combinations alone', () => {
    expect(actionFor(key({ key: 's', code: 'KeyS', ctrlKey: true }), false)).toBeNull();
    expect(actionFor(key({ key: 'k', code: 'KeyK', metaKey: true }), false)).toBeNull();
  });
});
