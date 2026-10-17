import { SRT, WEBVTT } from '@microvtt/core';
import { describe, expect, it } from 'vitest';
import { baseName, checkFileName, withExtension } from './filename.ts';

describe('file names', () => {
  it('takes off subtitle extensions only', () => {
    expect(baseName('film.vtt')).toBe('film');
    expect(baseName('film.SRT')).toBe('film');
    expect(baseName('Episode 1.5')).toBe('Episode 1.5');
    expect(baseName('notes.txt')).toBe('notes.txt');
    expect(baseName('.vtt')).toBe('.vtt');
  });

  it('gives the name the extension of the format written', () => {
    expect(withExtension('film.srt', WEBVTT)).toBe('film.vtt');
    expect(withExtension('film.vtt', SRT)).toBe('film.srt');
    expect(withExtension('Episode 1.5', WEBVTT)).toBe('Episode 1.5.vtt');
  });

  it('checks a typed name', () => {
    expect(checkFileName('  Episode 2  ', WEBVTT)).toEqual({ name: 'Episode 2.vtt' });
    expect(checkFileName('film.srt', WEBVTT)).toEqual({ name: 'film.vtt' });
    expect(checkFileName('film.vtt', SRT)).toEqual({ name: 'film.srt' });
    expect(checkFileName('', WEBVTT)).toHaveProperty('error');
    expect(checkFileName('.vtt', WEBVTT)).toHaveProperty('error');
    expect(checkFileName('..', WEBVTT)).toHaveProperty('error');
    expect(checkFileName('a/b', WEBVTT)).toHaveProperty('error');
    expect(checkFileName('what?', WEBVTT)).toHaveProperty('error');
    expect(checkFileName('tab\there', WEBVTT)).toHaveProperty('error');
  });
});
