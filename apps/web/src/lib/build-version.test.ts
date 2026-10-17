import { describe, expect, it } from 'vitest';
import { versionLabel } from './build-version.ts';

describe('the version shown in the app', () => {
  it('is the plain version for a clean build of its release tag', () => {
    expect(versionLabel('0.1.0', { tagged: true, commit: 'abc1234', dirty: false })).toBe('0.1.0');
  });

  it('names the commit for builds between releases', () => {
    expect(versionLabel('0.1.0', { tagged: false, commit: 'abc1234', dirty: false })).toBe(
      '0.1.0+abc1234',
    );
    expect(versionLabel('0.1.0', { tagged: true, commit: 'abc1234', dirty: true })).toBe(
      '0.1.0+abc1234.dirty',
    );
  });

  it('is the plain version without git', () => {
    expect(versionLabel('0.1.0', null)).toBe('0.1.0');
  });
});
