// Writes the YouTube upload test files in docs/ from the feature catalogue in
// packages/core/src/features.ts. See docs/YOUTUBE-TEST.md for how to use them.
// Usage: node scripts/youtube-test.mjs   (a test fails when the committed files are stale)
import { writeFileSync } from 'node:fs';
import { featureTestFile } from '../packages/core/src/features.ts';

/** File name (in docs/) → contents. */
export function render() {
  return {
    // Every feature, STYLE and REGION blocks included.
    'youtube-test.vtt': featureTestFile(),
    // The same without STYLE and REGION blocks, in case they make YouTube reject the file.
    'youtube-test-no-blocks.vtt': featureTestFile(6000, ['style', 'region']),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, text] of Object.entries(render())) {
    writeFileSync(new URL(`../docs/${name}`, import.meta.url), text);
    console.log(`Wrote docs/${name}`);
  }
}
