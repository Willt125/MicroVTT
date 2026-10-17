# Feedback log

Bugs and suggestions from people using MicroVTT. They arrive at any time, not on the phase plan
in [PLAN.md](PLAN.md), so they are tracked here instead.

## How feedback comes in

- **GitHub issues**, using the templates: **Bug report** or **Feature request**. Blank issues are
  turned off so that every report says which browser and build it came from.
- **Passed on by the owner**, for people who do not use GitHub. The owner opens an issue for it,
  or the item goes straight into this log.

The repository is public, so issues are too. The templates ask for a few cues typed or trimmed
by hand rather than whole caption files or media, which may be private or someone else's work.
Real files used for testing stay in `tests/private-fixtures/`, which is never committed.

## How an item is handled

1. **Triage.** The issue gets its label (`bug` or `enhancement`). It is added to **Open** below,
   with a link to the issue, when someone starts on it or decides it will be done.
2. **Fix.** A pull request that says `Fixes #N` closes the issue when it merges. Design choices the
   owner makes along the way also go in the decisions log in [PLAN.md](PLAN.md).
3. **Record.** The item moves to **Done**, with the date, the pull request, and a few lines on what
   changed. Anything that changes how the editor is used also goes in [MANUAL.md](MANUAL.md).

Ideas that come up but nobody has committed to go under **Ideas**, so they are not lost.

## Open

Nothing at the moment.

## Ideas

- **Drag a word timing on the timeline to retime it.** The ticks drawn for word timings
  ([#42](https://github.com/Willt125/MicroVTT/pull/42)) could be handles, the way cue edges are.

## Done

### First demo hand-out (2026-10-12 to 2026-10-17)

- **Rename the file in the editor** ([#42](https://github.com/Willt125/MicroVTT/pull/42)). Click
  the file name in the toolbar's status area to edit it in place. The new name is what the tab
  title, autosave and Export use, and what the file is saved as. After a rename, **Save to
  _name_** (overwriting the opened file) is not offered: **Save as…**, pre-filled with the new
  name, becomes the primary action. The file on disk is never renamed.
- **Always ask where to save** ([#42](https://github.com/Willt125/MicroVTT/pull/42)). Where the
  File System Access API exists (Chromium), export always goes through **Save as…** (the system
  save dialog), or **Save to _name_** for a file opened in place. **Download**, which saved
  straight to the Downloads folder, is gone; it is offered only if the save dialog fails to open
  (not when it is cancelled). Firefox and Safari have no API to force the dialog: export there is
  a download, and the Export dialog names the browser setting that makes it ask. The single-file
  build opened from disk is a secure context in Chromium, and the save dialog is available there.
- **Playhead to the mouse on the timeline** ([#42](https://github.com/Willt125/MicroVTT/pull/42)).
  **P** moves the playhead to the time under the mouse pointer on the timeline, without clicking.
- **Word timings on the timeline** ([#42](https://github.com/Willt125/MicroVTT/pull/42)). Each
  cue's word timings are drawn in its block as short faint ticks, not dashed lines, since a dashed
  line already marks the snap point while dragging.
- **Split keeps the text cursor from the toolbar button**
  ([#42](https://github.com/Willt125/MicroVTT/pull/42)). The cursor counts only when the cue text
  has focus, and clicking **Split** (or **Merge**) used to move focus to the button, so the cue
  was cut near its middle instead. The buttons no longer take focus when clicked. `MANUAL.md`
  describes how the split time and text cut are chosen with and without media.
- **Frame steps lost in Safari** ([#42](https://github.com/Willt125/MicroVTT/pull/42), found by
  CI). WebKit reported the old position in events during a seek, so quick frame steps were
  computed from a stale time. The player no longer reads the element's time while it is seeking.
- **Space plays after a mouse click on a control**
  ([#43](https://github.com/Willt125/MicroVTT/pull/43)). A button, checkbox or section header
  clicked with the mouse kept focus (in Chromium and Firefox; Safari never gives it), so the next
  Space pressed it again (**Add cue** added another cue) instead of playing. Controls clicked with
  the mouse now let go of focus; ones reached with the keyboard keep it, so Space and Enter still
  press them. Controls in dialogs and **Tap** (tap timing, where Space taps) keep focus. The cost,
  accepted by the owner since the users work from the keyboard shortcuts: a control clicked with
  the mouse shows no focus outline.
