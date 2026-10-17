import { describe, expect, it } from 'vitest';
import { titleProblem } from './pr-title.mjs';

describe('pull request titles', () => {
  it('accepts conventional commit headers', () => {
    for (const title of [
      'fix(web): keep the seek target while seeking',
      'feat: rename the file from the toolbar',
      'feat(core)!: write regions before styles',
      'docs: move user feedback into FEEDBACK.md',
      'chore(deps): bump vite from 8.0.1 to 8.0.2',
      'ci(deps): bump the github-actions group with 2 updates',
      'fix(srt): read SRT files in Windows-1252',
      'fix: Firefox loses the playhead after a seek',
      'docs: WebVTT notes for regions',
    ])
      expect(titleProblem(title), title).toBeNull();
  });

  it('says what is wrong with other titles', () => {
    expect(titleProblem('Space plays after a mouse click')).toMatch(/type\(scope\)/);
    expect(titleProblem('feature: add P')).toMatch(/not a type/);
    expect(titleProblem('fix:no space')).toMatch(/type\(scope\)/);
    expect(titleProblem('fix:  two spaces')).toMatch(/one space/);
    expect(titleProblem('fix: ends with a full stop.')).toMatch(/full stop/);
    expect(titleProblem(`fix: ${'x'.repeat(80)}`)).toMatch(/keep it to 72/);
    expect(titleProblem('Fix(web): wrong case type')).toMatch(/type\(scope\)/);
  });
});
