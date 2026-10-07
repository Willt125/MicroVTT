# Diagnostics

Every problem the validator reports, and what export does about it. Generated from
`packages/core/src/diagnostics.ts` by `node scripts/diagnostics-doc.mjs`; do not edit by hand.

Codes are stable identifiers. Errors are conformance failures; warnings mark valid syntax that
does not do what it looks like (for example a cue setting that user agents ignore); info is
advisory. Export always produces a file with no errors.

| Code | Severity | Rule | Export | Spec |
| --- | --- | --- | --- | --- |
| `signature-invalid` | error | A WebVTT file must start with "WEBVTT", optionally followed by a space or tab and text. | None: the file is not WebVTT and cannot be imported. | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `signature-line-terminators` | error | The "WEBVTT" line must be followed by a blank line (two or more line terminators). | A blank line is written after the signature line. | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `header-text` | error | Text directly after the "WEBVTT" line (such as "Kind:" / "Language:") is not allowed; parsers ignore it. | The text is kept as a NOTE comment. | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `missing-final-line-terminator` | error | Every block, including the last, must end with a line terminator. | The file ends with a line feed. | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `block-missing-blank-line` | error | Blocks must be separated by a blank line. A line containing "-->" always starts a new block. | A blank line is inserted. If the line was meant as text, edit it and escape the arrow as "--&gt;". | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `block-discarded` | error | Every block must be a cue, a comment (NOTE), a STYLE block or a REGION block; parsers drop anything else. | The text is kept as a NOTE comment. | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `style-after-cue` | error | STYLE blocks must come before the first cue; parsers ignore them afterwards. | The block is kept as a NOTE comment (moving it would change how the file renders). | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `region-after-cue` | error | REGION blocks must come before the first cue; parsers ignore them afterwards. | The block is kept as a NOTE comment (moving it would change how the file renders). | [§](https://w3c.github.io/webvtt/#webvtt-file-body) |
| `block-keyword-whitespace` | error | Only spaces and tabs may follow "STYLE" or "REGION" on its line. | The keyword line is rewritten. | [§](https://w3c.github.io/webvtt/#webvtt-style-block) |
| `style-empty` | info | A STYLE block with no style sheet has no effect; parsers ignore it. | The empty block is removed. | [§](https://w3c.github.io/webvtt/#webvtt-style-block) |
| `note-contains-arrow` | error | A comment (NOTE) must not contain "-->". | The comment is kept with the arrow broken up ("-- >"). | [§](https://w3c.github.io/webvtt/#webvtt-comment-block) |
| `cue-timings-invalid` | error | A line containing "-->" must be valid cue timings; otherwise parsers drop the whole block. | The block is kept as a NOTE comment. | [§](https://w3c.github.io/webvtt/#webvtt-cue-timings) |
| `timestamp-syntax` | error | Timestamps are [hh:]mm:ss.ttt with at least two hour digits when hours are present. | The timestamp is rewritten in canonical form. | [§](https://w3c.github.io/webvtt/#webvtt-timestamp) |
| `timing-whitespace` | error | Cue timings are "start --> end" with spaces or tabs around the arrow and before the settings, and nothing before the start time. | The timing line is rewritten. | [§](https://w3c.github.io/webvtt/#webvtt-cue-timings) |
| `cue-start-order` | error | A cue must not start before the previous cue in the file. | Cues are sorted by start time (stable). | [§](https://w3c.github.io/webvtt/#webvtt-cue-timings) |
| `cue-end-not-after-start` | error | A cue's end time must be greater than its start time. | The end time is set to the start time plus 1 ms. | [§](https://w3c.github.io/webvtt/#webvtt-cue-timings) |
| `cue-id-duplicate` | error | Cue identifiers must be unique. | A numeric suffix is added to later duplicates. | [§](https://w3c.github.io/webvtt/#webvtt-cue-identifier) |
| `cue-id-invalid` | error | A cue identifier is one line and must not contain "-->". (Only possible through editing; files cannot express it.) | Line breaks become spaces and arrows are broken up ("-- >"). | [§](https://w3c.github.io/webvtt/#webvtt-cue-identifier) |
| `cue-id-keyword` | warning | A cue id that starts with "NOTE", "STYLE" or "REGION" is valid, but browsers may drop the id, and ffmpeg, video.js and Shaka Player may drop the whole cue. | Kept. The export option "Remove cue ids that start with NOTE, STYLE or REGION" removes them. | [§](https://w3c.github.io/webvtt/#webvtt-cue-identifier) |
| `cue-settings-whitespace` | error | Cue settings are separated by spaces or tabs, with nothing after the last one. | The settings are rewritten. | [§](https://w3c.github.io/webvtt/#webvtt-cue-settings-list) |
| `cue-setting-malformed` | error | Each cue setting is "name:value" with a non-empty name and value. | The setting is dropped (parsers ignore it). | [§](https://w3c.github.io/webvtt/#webvtt-cue-settings-list) |
| `cue-setting-unknown` | error | The only cue settings are vertical, line, position, size, align and region. | The setting is dropped (parsers ignore it). | [§](https://w3c.github.io/webvtt/#webvtt-cue-settings-list) |
| `cue-setting-duplicate` | error | Each cue setting may appear at most once. | The setting is written once, with the value parsers use. | [§](https://w3c.github.io/webvtt/#webvtt-cue-settings-list) |
| `cue-setting-value` | error | Each cue setting has a fixed set of valid values. | Invalid values are dropped (parsers ignore them); valid-but-noncanonical values are rewritten. | [§](https://w3c.github.io/webvtt/#webvtt-cue-settings-list) |
| `cue-setting-legacy` | error | A cue setting uses a name from an older draft of the spec ("middle", or "start"/"end" as a position alignment). Parsers ignore the whole setting; YouTube still writes them. | MicroVTT reads it as it was meant, and export writes the current name ("center", "line-left", "line-right"). | [§](https://w3c.github.io/webvtt/#webvtt-cue-settings-list) |
| `cue-line-not-integer` | error | A line number (without %) must be an integer. | The line number is rounded to the nearest integer. | [§](https://w3c.github.io/webvtt/#webvtt-line-cue-setting) |
| `cue-region-undefined` | warning | The cue refers to a region that is not defined before the first cue. | The region reference is dropped (parsers ignore it). | [§](https://w3c.github.io/webvtt/#webvtt-region-cue-setting) |
| `cue-region-ignored` | warning | A cue with a vertical, line or size setting is taken out of its region. | The region reference is dropped (parsers ignore it). | [§](https://w3c.github.io/webvtt/#webvtt-region-cue-setting) |
| `cue-text-character-reference` | error | A "&" must start a valid character reference ending in ";" (write a literal & as "&amp;"). | The cue text is rewritten with valid references. | [§](https://w3c.github.io/webvtt/#webvtt-caption-or-subtitle-cue-text) |
| `cue-text-tag` | error | Tags are <c>, <i>, <b>, <u>, <ruby>, <rt>, <v>, <lang> and timestamps (write a literal < as "&lt;"). | The cue text is rewritten; unknown tags are dropped as parsers drop them. | [§](https://w3c.github.io/webvtt/#webvtt-caption-or-subtitle-cue-text) |
| `cue-text-class` | error | A class name follows "." immediately and has no spaces, "&", "<", ">" or ".". | The cue text is rewritten without empty classes. | [§](https://w3c.github.io/webvtt/#webvtt-cue-span-start-tag) |
| `cue-text-annotation` | error | <v> and <lang> require an annotation; other tags must not have one. | The cue text is rewritten; annotations parsers ignore are dropped. | [§](https://w3c.github.io/webvtt/#webvtt-cue-span-start-tag) |
| `cue-text-nesting` | error | Spans must be closed in order. Only a voice span that is the whole cue, or the last ruby text, may omit its end tag. | The cue text is rewritten with the structure parsers build. | [§](https://w3c.github.io/webvtt/#webvtt-caption-or-subtitle-cue-text) |
| `cue-text-ruby` | error | <rt> may only appear directly inside <ruby>, and a ruby span needs base text followed by <rt>. | The cue text is rewritten with the structure parsers build. | [§](https://w3c.github.io/webvtt/#webvtt-cue-ruby-span) |
| `cue-text-timestamp` | error | Timestamps in cue text must be valid, increasing, and inside the cue. | Invalid or out-of-order timestamps are removed; the text is kept. | [§](https://w3c.github.io/webvtt/#webvtt-cue-timestamp) |
| `cue-text-language` | error | A <lang> annotation must be a valid BCP 47 language tag. | The language span is unwrapped; its text is kept. | [§](https://w3c.github.io/webvtt/#webvtt-cue-language-span) |
| `chapter-title-markup` | error | Chapter titles may only contain text and character references. | Markup is removed; the title text is kept. | [§](https://w3c.github.io/webvtt/#webvtt-chapter-title-text) |
| `chapters-not-nested` | error | In a chapters file every pair of cues must either nest or not overlap. | None automatically: fix the chapter times. | [§](https://w3c.github.io/webvtt/#webvtt-file-using-only-nested-cues) |
| `region-id-missing` | error | Every region must have an id. | The region is removed (no cue can refer to it). | [§](https://w3c.github.io/webvtt/#webvtt-region-identifier-setting) |
| `region-id-duplicate` | error | Region ids must be unique. | Earlier duplicates are removed (cues use the last region with an id). | [§](https://w3c.github.io/webvtt/#webvtt-region-identifier-setting) |
| `region-id-invalid` | error | A region id must not contain "-->". | The region and references to it are renamed. | [§](https://w3c.github.io/webvtt/#webvtt-region-identifier-setting) |
| `region-settings-whitespace` | error | Region settings are separated by spaces, tabs or single line breaks. | The settings are rewritten. | [§](https://w3c.github.io/webvtt/#webvtt-region-settings-list) |
| `region-setting-malformed` | error | Each region setting is "name:value" with a non-empty name and value. | The setting is dropped (parsers ignore it). | [§](https://w3c.github.io/webvtt/#webvtt-region-settings-list) |
| `region-setting-unknown` | error | The only region settings are id, width, lines, regionanchor, viewportanchor and scroll. | The setting is dropped (parsers ignore it). | [§](https://w3c.github.io/webvtt/#webvtt-region-settings-list) |
| `region-setting-duplicate` | error | Each region setting may appear at most once. | The setting is written once, with the value parsers use. | [§](https://w3c.github.io/webvtt/#webvtt-region-settings-list) |
| `region-setting-value` | error | Each region setting has a fixed set of valid values. | Invalid values are dropped (parsers ignore them). | [§](https://w3c.github.io/webvtt/#webvtt-region-settings-list) |
| `style-css-syntax` | error | A STYLE block must contain a valid CSS style sheet. | Rules and declarations that do not parse are removed. | [§](https://w3c.github.io/webvtt/#webvtt-style-block) |
| `style-selector` | warning | Only ::cue and ::cue-region rules affect WebVTT cues. | None: the rule is kept as written. | [§](https://w3c.github.io/webvtt/#the-cue-pseudo-element) |
| `style-property-ignored` | warning | This property does not apply to ::cue or ::cue-region and is ignored. | None: the declaration is kept as written. | [§](https://w3c.github.io/webvtt/#the-cue-pseudo-element) |
