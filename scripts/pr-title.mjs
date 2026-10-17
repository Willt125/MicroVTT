/**
 * Checks a pull request title against Conventional Commits 1.0.0, as CONTRIBUTING.md asks: PRs
 * are squash-merged, so the title becomes the commit on main. Run in CI with the title in the
 * PR_TITLE environment variable (never interpolated into the shell).
 */
import { fileURLToPath } from 'node:url';

export const TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'test',
  'docs',
  'build',
  'ci',
  'chore',
  'revert',
  'style',
];

const HEADER =
  /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9-]*)\))?(?<breaking>!)?: (?<description>.+)$/;
const MAX_LENGTH = 72;

/** Why `title` is not a conventional commit header, or null when it is one. */
export function titleProblem(title) {
  if (title.length > MAX_LENGTH)
    return `The title is ${title.length} characters; keep it to ${MAX_LENGTH}.`;
  const m = HEADER.exec(title);
  if (!m?.groups)
    return 'Write the title as "type(scope): description", e.g. "fix(web): keep the playhead when seeking"; the scope is optional.';
  const { type, description } = m.groups;
  if (!TYPES.includes(type))
    return `"${type}" is not a type here; use one of: ${TYPES.join(', ')}.`;
  if (/^\s/.test(description)) return 'Put exactly one space after the colon.';
  if (/[.\s]$/.test(description)) return 'End the description without a full stop or space.';
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const title = process.env['PR_TITLE'] ?? '';
  const problem = titleProblem(title);
  if (problem) {
    console.error(`Pull request title: ${JSON.stringify(title)}\n${problem}`);
    console.error('See CONTRIBUTING.md, "Commits and pull request titles".');
    process.exit(1);
  }
  console.log(`OK: ${title}`);
}
