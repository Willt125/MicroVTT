# Changelog

All notable changes to MicroVTT are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html); what counts as the public API
is set out in [CONTRIBUTING.md](CONTRIBUTING.md#versioning).

## [Unreleased]

The first tagged release will be 0.1.0. Everything below is what it contains. While the version
is 0.y.z, anything may still change.

### Added

- **Opening files:** WebVTT and SubRip files, opened from disk, dropped onto the page or pasted.
  Many legacy encodings are read, and malformed and old-draft files are read leniently. Unsaved
  work is autosaved in the browser and offered back after a closed tab.
- **Editing:** a cue list with multiple selection, and an editor for times, text, markup (italic,
  bold, underline, classes, voices, languages, ruby), word timings (including tap timing), cue
  settings, placement presets and regions. There are undo and redo, find and replace (with
  regular expressions), a glossary of corrections, and right-to-left and invisible-character
  tools.
- **Media:** a player with frame stepping, and a timeline with the waveform, cue blocks to drag
  and snap, and word-timing ticks. The spec renderer draws captions the way the WebVTT spec
  says, the same in every browser.
- **Checks:** every WebVTT conformance check, with what export does about each, plus style and
  accessibility rules from Basic checks, WCAG 2.2, Netflix (several languages) and the BBC.
- **Tools:** timing (shift, two-point resync, frame rate change), cleanup of YouTube
  auto-captions, roll-up captions, karaoke and paint-on styles, a style sheet editor, and chapters
  and metadata files.
- **Export:** WebVTT or SubRip, converting between them. Export repairs the file so it conforms,
  offers player-compatibility fixes, and checks the file for YouTube. Chromium always asks where
  to save, through the system save dialog.
- **Distribution:** a single-file build, `microvtt.html`, to open from disk or pass around.
- **Version:** shown at the bottom of the keyboard shortcuts dialog (`?`). Builds between releases
  add the commit they were built from, as in `0.1.0+abc1234`.

[Unreleased]: https://github.com/Willt125/MicroVTT/commits/main
