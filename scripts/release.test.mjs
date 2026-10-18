import { describe, expect, it } from 'vitest';
import { checkVersions, releaseNotes, tagVersion } from './release.mjs';

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Fixed

- Something not released yet.

## [0.2.0] - 2026-11-01

### Added

- A tool.

## [0.1.0] - 2026-10-18

The first release.

### Added

- Everything.

[Unreleased]: https://example.com/compare/v0.2.0...HEAD
[0.2.0]: https://example.com/compare/v0.1.0...v0.2.0
[0.1.0]: https://example.com/releases/tag/v0.1.0
`;

describe('release tags', () => {
  it('reads the version from vX.Y.Z', () => {
    expect(tagVersion('v0.1.0')).toBe('0.1.0');
    expect(tagVersion('v1.10.3')).toBe('1.10.3');
    expect(tagVersion('v2.0.0-rc.1')).toBe('2.0.0-rc.1');
  });

  it('refuses anything else', () => {
    for (const tag of ['0.1.0', 'v0.1', 'v01.0.0', 'v0.1.0+abc1234', 'release-1', ''])
      expect(() => tagVersion(tag), tag).toThrow(/not a release tag/);
  });

  it('wants every package at the tag version', () => {
    expect(() =>
      checkVersions('0.1.0', { 'package.json': '0.1.0', 'a/package.json': '0.1.0' }),
    ).not.toThrow();
    expect(() =>
      checkVersions('0.1.0', { 'package.json': '0.1.0', 'a/package.json': '0.0.0' }),
    ).toThrow('a/package.json has 0.0.0');
    expect(() => checkVersions('0.1.0', { 'package.json': undefined })).toThrow('no version');
  });
});

describe('release notes', () => {
  it("takes the version's section, without its heading or the links", () => {
    expect(releaseNotes(CHANGELOG, '0.1.0')).toBe(
      'The first release.\n\n### Added\n\n- Everything.',
    );
    expect(releaseNotes(CHANGELOG, '0.2.0')).toBe('### Added\n\n- A tool.');
  });

  it('fails without a section, or with an empty one', () => {
    expect(() => releaseNotes(CHANGELOG, '0.3.0')).toThrow('no "## [0.3.0]" section');
    expect(() => releaseNotes('## [0.1.0] - 2026-10-18\n\n## [0.0.1]\n', '0.1.0')).toThrow('empty');
  });
});
