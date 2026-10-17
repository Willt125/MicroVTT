/**
 * File names as the editor shows and saves them: a base name the user can change, and an
 * extension that always follows the format written.
 */
import { FORMATS, type SubtitleFormat } from '@microvtt/core';

/** Characters that Windows, macOS or Linux refuse in a file name. */
const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/u;

/** The name without a subtitle extension (.vtt, .srt); other dots are part of the name. */
export function baseName(name: string): string {
  const lower = name.toLowerCase();
  for (const f of FORMATS)
    for (const ext of f.extensions)
      if (lower.endsWith(ext) && name.length > ext.length) return name.slice(0, -ext.length);
  return name;
}

/** The file name for `name` written in `format`: its base name with the format's extension. */
export function withExtension(name: string, format: SubtitleFormat): string {
  return baseName(name) + (format.extensions[0] ?? '');
}

/**
 * A new file name typed by the user, for a file in `format`: the full name, or why it cannot be
 * one. A subtitle extension typed at the end is replaced by the format's own.
 */
export function checkFileName(
  input: string,
  format: SubtitleFormat,
): { name: string } | { error: string } {
  const typed = input.trim();
  // ".vtt" alone is an extension without a name.
  const base = (
    FORMATS.some((f) => f.extensions.includes(typed.toLowerCase())) ? '' : baseName(typed)
  ).trim();
  if (base === '' || /^\.+$/.test(base)) return { error: 'Enter a file name.' };
  if (FORBIDDEN.test(base))
    return { error: 'A file name cannot contain / \\ : * ? " < > | or control characters.' };
  return { name: base + (format.extensions[0] ?? '') };
}
