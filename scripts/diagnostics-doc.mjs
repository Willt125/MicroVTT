// Renders docs/DIAGNOSTICS.md from the diagnostic registry in packages/core/src/diagnostics.ts.
// Usage: node scripts/diagnostics-doc.mjs   (a test fails when the committed file is stale)
import { writeFileSync } from 'node:fs';
import { DIAGNOSTICS } from '../packages/core/src/diagnostics.ts';

const SPEC = 'https://w3c.github.io/webvtt/#';
const escape = (s) => s.replace(/\|/g, '\\|');

export function render() {
  const rows = Object.entries(DIAGNOSTICS).map(
    ([code, d]) =>
      `| \`${code}\` | ${d.severity} | ${escape(d.rule)} | ${escape(d.fix)} | ${d.spec === '' ? '—' : `[§](${SPEC}${d.spec})`} |`,
  );
  return `# Diagnostics

Every problem the validator reports, and what export does about it. Generated from
\`packages/core/src/diagnostics.ts\` by \`node scripts/diagnostics-doc.mjs\`; do not edit by hand.

Codes are stable identifiers. Errors are conformance failures; warnings mark valid syntax that
does not do what it looks like (for example a cue setting that user agents ignore); info is
advisory. Export always produces a file with no errors. Codes starting \`srt-\` are for SubRip
files, which have no specification: their rules are what players commonly read.

| Code | Severity | Rule | Export | Spec |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../docs/DIAGNOSTICS.md', import.meta.url), render());
  console.log('Wrote docs/DIAGNOSTICS.md');
}
