/**
 * Checks a release tag against the repository and prints its release notes, for the release
 * workflow (see CONTRIBUTING.md, "Releasing"): `node scripts/release.mjs v0.1.0 > notes.md`.
 * Fails when the tag is not vX.Y.Z, when a package.json carries another version, or when
 * CHANGELOG.md has no section for it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGES = ['package.json', 'apps/web/package.json', 'packages/core/package.json'];
// SemVer 2.0.0 (§2, §9, §10): MAJOR.MINOR.PATCH, an optional pre-release and build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** The version a release tag names ("v0.1.0" → "0.1.0"), or throws. */
export function tagVersion(tag) {
  const version = tag.startsWith('v') ? tag.slice(1) : '';
  if (!SEMVER.test(version) || version.includes('+'))
    throw new Error(`"${tag}" is not a release tag: use vX.Y.Z (SemVer 2.0.0, no build metadata).`);
  return version;
}

/** Throws unless every package carries `version`. `packages` maps file names to versions. */
export function checkVersions(version, packages) {
  const wrong = Object.entries(packages).filter(([, v]) => v !== version);
  if (wrong.length > 0)
    throw new Error(
      `The tag is ${version}, but ${wrong.map(([f, v]) => `${f} has ${v ?? 'no version'}`).join(', ')}.`,
    );
}

/** The body of CHANGELOG.md's section for `version`, without its heading, or throws. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/[.+]/g, '\\$&');
  const start = lines.findIndex((l) => new RegExp(`^## \\[${escaped}\\]`).test(l));
  if (start === -1) throw new Error(`CHANGELOG.md has no "## [${version}]" section.`);
  const rest = lines.slice(start + 1);
  // Up to the next section or the link definitions at the bottom.
  const end = rest.findIndex((l) => /^## \[/.test(l) || /^\[[^\]]+\]: /.test(l));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  if (notes === '') throw new Error(`CHANGELOG.md's section for ${version} is empty.`);
  return notes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const root = new URL('..', import.meta.url);
    const version = tagVersion(process.argv[2] ?? '');
    const read = (path) => readFileSync(new URL(path, root), 'utf8');
    checkVersions(
      version,
      Object.fromEntries(PACKAGES.map((p) => [p, JSON.parse(read(p)).version])),
    );
    process.stdout.write(`${releaseNotes(read('CHANGELOG.md'), version)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
