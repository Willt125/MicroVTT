# MicroVTT manual

MicroVTT is a caption and subtitle editor that runs in the browser. It opens WebVTT (`.vtt`) and
SubRip (`.srt`) files, checks them against the spec and against caption style guides, lets you
edit and time them against audio or video, and writes them back out, fixing what it can on the
way. Everything happens on your device: files are never uploaded.

This manual gives you a picture of each tool: what it is for, how it thinks, and where to find
it. Hover over any button in the app for a short reminder of what it does; most tooltips also
name the keyboard shortcut.

`Ctrl` below means `⌘` on a Mac, iPhone or iPad.

## Contents

1. [The big picture](#1-the-big-picture)
2. [Opening and starting files](#2-opening-and-starting-files)
3. [The screen](#3-the-screen)
4. [The cue list](#4-the-cue-list)
5. [Editing a cue](#5-editing-a-cue)
6. [Media and the timeline](#6-media-and-the-timeline)
7. [Problems: conformance checks](#7-problems-conformance-checks)
8. [Style and accessibility checks](#8-style-and-accessibility-checks)
9. [Timing tools](#9-timing-tools)
10. [Find, replace and the glossary](#10-find-replace-and-the-glossary)
11. [Styles, regions and placement](#11-styles-regions-and-placement)
12. [Karaoke and paint-on captions](#12-karaoke-and-paint-on-captions)
13. [Cleaning up YouTube auto-captions](#13-cleaning-up-youtube-auto-captions)
14. [Roll-up captions](#14-roll-up-captions)
15. [Chapters and metadata files](#15-chapters-and-metadata-files)
16. [Exporting and saving](#16-exporting-and-saving)
17. [SubRip (.srt) files](#17-subrip-srt-files)
18. [Autosave, storage and themes](#18-autosave-storage-and-themes)
19. [Keyboard shortcuts](#19-keyboard-shortcuts)
20. [The single-file build](#20-the-single-file-build)

## 1. The big picture

A caption file is a list of **cues**. Each cue has a start time, an end time and some text, and
in WebVTT optionally an id, placement settings (line, position, size, alignment, region) and
inline markup (italics, voices, classes, word timings). A WebVTT file can also carry a
**header**: STYLE blocks (CSS for the cues), REGION blocks (areas cues can be placed in) and
NOTE comments.

MicroVTT keeps three ideas in view at all times:

- **The document.** What you edit is the parsed file, not raw text. Every change goes through
  undo/redo, and many tools (cleanup, roll-up, timing, glossary) are a single undo step, so you
  can try them and back out.
- **Checks run continuously.** The **Problems** panel says where the file breaks the WebVTT
  spec (or SRT's conventions). The **Style and accessibility** panel says where it breaks a
  caption style guide such as Netflix's or the BBC's. Both update as you type.
- **Export repairs.** You do not have to fix every error by hand: export rewrites the file so it
  conforms and tells you exactly what it changed. It also offers fixes for players that misread
  valid files.

The **Type** select in the toolbar (WebVTT only) says what the file holds, and the checks and
tools follow it:

| Type                 | Text field holds                        | Side panel              |
| -------------------- | --------------------------------------- | ----------------------- |
| Captions / subtitles | Caption text with markup                | Style and accessibility |
| Chapters             | Plain-text chapter titles               | Chapters                |
| Metadata             | Data for scripts (often JSON)           | (none)                  |
| Any (structure only) | Anything; only the structure is checked | (none)                  |

MicroVTT guesses the type when it opens a file and offers to switch if it looks wrong ("This
looks like a chapters file…").

## 2. Opening and starting files

There are several ways in:

- **Open…** (`Ctrl+O`) picks a `.vtt` or `.srt` file. In Chrome and Edge the app remembers the
  file, so you can later save straight back to it.
- **Drop** a file anywhere on the page. A caption file opens; an audio or video file loads into
  the player.
- **Paste** WebVTT or SRT text anywhere outside a text field.
- **New** starts an empty file.

The format is detected from the content (a `WEBVTT` header or SRT cue times), not just the file
extension.

When a file opens, a few **banners** may appear under the toolbar. Each one is an offer you can
take or dismiss:

- **Encoding.** The file was not UTF-8, so MicroVTT guessed an encoding (for example
  Windows-1252 or Shift_JIS). If accented letters look wrong, pick another encoding from the
  banner; this works until you start editing. Export writes UTF-8 unless you ask otherwise
  (SRT only).
- **Language guess.** The file names no language, but the text looks like, say, Finnish. Setting
  it helps spelling, line breaking and choosing the right style rules.
- **File type guess.** The cues look like chapter titles or metadata rather than captions.
- **Roll-up captions.** The file looks like YouTube auto-captions, which repeat each line
  across rolling cues. **Clean up…** turns them into ordinary cues (see
  [section 13](#13-cleaning-up-youtube-auto-captions)).

If you closed the tab with unsaved edits, the start screen offers to **Restore** or **Discard**
that work.

## 3. The screen

```
┌─────────────────────────── toolbar ───────────────────────────┐
│ banners                                                        │
├──────────────────────────────┬─────────────────────────────────┤
│ Find bar (when open)         │ Media player (when loaded)      │
│ Cue list                     │ Problems                        │
│ Selected cue (editor)        │ Style and accessibility         │
│                              │   or Chapters                   │
├──────────────────────────────┴─────────────────────────────────┤
│ Timeline (when media is loaded)                                │
└────────────────────────────────────────────────────────────────┘
```

On a narrow window the two columns stack.

The **toolbar** has three groups:

- **File:** New, Open…, Media…, Export…, and the Type select.
- **Edit:** Undo, Redo, Add cue, Delete, Split, Merge, Find, Timing…, Roll-up…, Styles….
- **Auto-captions:** Clean up…, Glossary….

On the right are the theme picker and **?** for the keyboard shortcuts. The status area shows the
file name, "• edited" when there are unsaved changes, the cue count, and whether your edits are
autosaved.

**Click the file name to rename the file.** Type the new name and press Enter (Escape cancels).
The extension follows the format, so you type only the name. The new name is what Export saves
the file as; the file you opened keeps its name on disk, and saving goes through **Save as…**
from then on (see [Saving](#saving)).

## 4. The cue list

The list shows each cue's number, start, end, text (one line, shortened; hover for all of it)
and its worst problem ("Error", "Warning" or "Note", with ×N if there are several).

**Selecting** works like a file manager:

- Click selects a cue.
- Shift+click selects a range.
- Ctrl+click adds a cue to the selection or removes it.
- Ctrl+A selects every cue.

Many tools (Delete, Merge, Timing, Roll-up, cue settings) act on the whole selection.

**Keyboard in the list:**

- ↑/↓, PageUp/PageDown and Home/End move the selection.
- Enter or a double-click jumps into the cue's text.
- Delete removes the selected cues.

Only the visible rows are drawn, so files with tens of thousands of cues stay responsive.

**Add cue** (or `N`) inserts a cue after the selected one, or at the playhead when media is
open. **Merge** (`M`) joins the selected cues, or the cue with the next one; the second cue's
start is kept as a word timing at the join, so Merge is not an exact undo of Split (Undo is).

**Split** (`S`) makes two cues of one. It decides two things separately: where the text is cut,
and when the second cue starts.

|                                         | Text cursor in the cue text                               | No text cursor                                                                 |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Media open, playhead inside the cue** | Text cut at the cursor; time at the playhead              | Time at the playhead; text cut at the space nearest the same share of the text |
| **Otherwise**                           | Text cut at the cursor; time at the same share of the cue | Time at the middle; text cut at the space nearest the middle                   |

The cursor counts when the cue text has focus: click **Split** in the toolbar, or press `Alt+S`
while typing (plain `S` only works outside text fields). The shares count the text as written,
markup included, so without media the time is an estimate. The second cue gets no id; both keep
the cue's settings, and word timings go to the half they fall in.

## 5. Editing a cue

The **Selected cue** section under the list edits one cue at a time. With several cues selected
it shows one of them, and settings changes can apply to all of them.

### Times and id

- **Start** and **End** accept `h:mm:ss.ttt`, `m:ss.t` or plain seconds, and commit on Enter or
  when you leave the field.
- ↑/↓ nudge the time by 0.1 s (with Shift, 1 s).
- **Duration** is shown for reference.
- **ID** is an optional WebVTT cue identifier.

### Text and markup

The text field is the cue as written, markup included. In WebVTT that means tags such as
`<i>`, `<b>`, `<u>`, `<c.class>`, `<v Speaker>`, `<lang fr>`, `<ruby>` and word timings
`<00:01.500>`. The **markup toolbar** above the field writes the tags for you:

- **I / B / U** (`Ctrl+I/B/U`) toggle italic, bold and underline on the selection.
- **Class…** wraps the selection in `<c.name>`, which a style sheet can then target.
- **Voice…** marks who is speaking (`<v Mary>`).
- **Language…** marks a passage as another language (`<lang fr>`).
- **Ruby…** adds a small reading above the selection, such as furigana.
- **Clear** removes markup from the selection (or from the whole cue), keeping word timings.

The prompts suggest names already used in the file, so speakers and classes stay consistent.

Under the field, a **breadcrumb** ("In: v Mary › i") shows which spans the cursor is inside.
Click one to select its text, or × to remove the span and keep its text.

**Invisible characters** (direction marks, zero-width spaces and so on) are listed as small
buttons; click one to remove it. The **Insert mark…** menu adds them, including direction
isolates around the selection for mixed right-to-left and left-to-right text.

**Language** says what language the cue's text is in. It comes from the file's `Language:` line,
`<lang>` tags or the file name, or you can set it. It drives spelling, line breaking and which
style rules fit.

### Word timing

The **Word timing** panel (WebVTT captions) manages the timestamps inside a cue. Each timing
marks when the text after it starts. You can:

- edit times directly, or set one to the playhead;
- **Insert at cursor**, at the playhead or halfway between the timings either side;
- **Spread over words**, to estimate timings from word lengths;
- **Tap timing…**: play the cue and tap a button as each word starts;
- **Remove all**.

Timings are what karaoke and paint-on styles use (see [section 12](#12-karaoke-and-paint-on-captions)).

### Settings and placement

The **Settings** section (collapsed by default; its summary lists what is changed) controls where
the cue appears:

- **Line**: which line from the top or bottom, or a percentage of the height.
- **Position**, **Size** and the alignments: how wide the cue box is and where it sits
  horizontally.
- **Vertical**: vertical text for East Asian captions.
- **Region**: put the cue in a named region. **Edit…** opens the Regions dialog.

**Place: Bottom / Top / Middle** are quick presets, and **Reset all** goes back to a centred cue
at the bottom. While Settings is open, a small 16:9 **preview** draws the cue exactly where a
player would. With several cues selected, the changes apply to all of them by default.

SRT has no cue settings, only the `{\anN}` position tag. In an SRT file, Settings is a single
**Position** select (top left … bottom right).

### Cue problems

Problems for this cue are listed under the editor, so you see them while you type.

## 6. Media and the timeline

**Media…** (or dropping a file) loads audio or video to time against. Nothing is uploaded; the
browser plays the file directly. The player appears at the top of the side column, and the
timeline across the bottom.

### Player

- **Play/Pause** (`Space` or `K`).
- **±1 s** (`J` / `L`, with Shift for 5 s).
- **±1 frame** (`,` / `.`) step by frames. The **Frame rate** is measured from the video, or you
  can choose one.
- **Speed**: from 0.25× to 2×.
- **Set start / Set end** (`[` / `]`) copy the playhead time into the selected cue. This is the
  core timing loop: play, press `[` at the first word, `]` at the end, move on.
- **Loop cue** (`R`) repeats the selected cue while you adjust it.
- **Sync list** follows playback in the cue list, and plays from whichever cue you select.
- **Captions** draws the file over the video.

The **renderer** choice decides how captions are drawn:

- **Spec renderer:** MicroVTT draws captions following the WebVTT rendering rules, the same in
  every browser. Use it to see what the file _means_.
- **Browser renderer:** the browser's own caption display. Use it to see what viewers of a
  plain `<video>` element in this browser will get. Browsers differ: Chrome ignores regions, for
  example.

### Timeline

The timeline shows a time ruler, the audio **waveform**, a lane of cue blocks, and the playhead.

- Scroll to pan; Ctrl+scroll (or **+ / −**) to zoom; **Whole file** zooms out fully.
- Click empty space to seek.
- Click a cue to select it, with Shift and Ctrl working as in the list.
- Drag a cue's body to move it, together with the rest of the selection.
- Drag near a cue's edge to change just that start or end.

Edges **snap** to neighbouring cue edges, word timings and the playhead; a dashed line shows the
snap. Hold **Alt** while dragging to turn snapping off.

**Word timings** show as short ticks at the top and bottom of a cue's block. They move with the
cue when you drag it, and stay put when you drag one of its edges.

**P** moves the playhead to the time under the mouse pointer, without clicking: hover over the
moment you want and press `P` (`Alt+P` while typing).

The waveform is computed in the background and cached in the browser, so reopening the same media
is instant.

## 7. Problems: conformance checks

The **Problems** panel lists everything that makes the file non-conforming (errors) or probably
not what you meant (warnings and notes). Each entry names the cue (click to jump there) and links
to the spec section or rule behind it. [DIAGNOSTICS.md](DIAGNOSTICS.md) lists every check and
how export fixes it.

Below the main list are a few special sections:

- **Can be fixed.** Text that players silently ignore, such as a cue that lost its blank line
  and became part of a comment. The fix buttons turn it back into what was probably meant.
- **Not reached by the styles.** The style sheet styles `<c>` spans or `:past`/`:future` text,
  but some cue text is outside any tag, so the styles cannot reach it. **Wrap in `<c>`** fixes
  that.
- **To review.** For YouTube auto-captions: words YouTube censored as `[ __ ]` and sound tags
  like `[music]`.
- **Found when the file was opened.** Problems in the original file, and how export will fix
  them.

You never have to clear this panel before saving: export fixes all errors.

## 8. Style and accessibility checks

The **Style and accessibility** panel (captions only) checks the file against a caption guide.
Choose one under **Check against**:

- **Basic checks** (the default): broad readability limits.
- **WCAG 2.2**.
- **Netflix** timed text guides for English, Finnish, Chinese, Japanese and Korean, including
  SDH and children's variants.
- **BBC**.
- **Nothing**, to turn these checks off.

Findings are grouped by rule: line length, lines per cue, reading speed, minimum and maximum
duration, gaps between cues, and so on. Each group names its source ("Netflix English, section
…") and many offer a fix. **Rules…** lets you switch individual rules off or change their limits
for that guide; the changes are kept in this browser. If the guide's language does not match the
text, the panel says so and suggests one that fits.

The rules and their sources are listed in [QUALITY-RULES.md](QUALITY-RULES.md).

## 9. Timing tools

**Timing…** changes the times of all cues, or of the selected ones, in one of three ways:

- **Shift:** move everything earlier or later by an amount such as `-1.5` or `+0:02.250`. With
  media open, **First cue to the playhead** fills in the amount for you. Cues are never moved
  before 0.
- **Two-point resync:** for subtitles that drift out of sync over time. Pick two cues far apart,
  give each its correct start time (or take it from the playhead), and every cue is stretched
  and shifted so both land right.
- **Frame rate change:** for subtitles timed for a video at another frame rate, such as
  25 → 23.976 fps.

Word timings inside cues move with them. Each change is one undo step.

## 10. Find, replace and the glossary

**Find** (`Ctrl+F`) opens a bar above the list that searches the cue text as written, markup
included.

- **Aa** matches case; **Word** matches whole words only; **.\*** turns on regular expressions
  (use `$1` in the replacement for groups).
- **Across timings** (on by default) lets a space in your search also match a word-timing tag
  between words, so `ice cream` finds `ice <00:01.200>cream`.
- Enter goes to the next match, Shift+Enter to the previous one, and Escape closes the bar.
- **Replace** and **Replace all** do what they say. Replace all is one undo step.

The **Glossary** is a list of corrections you reuse across files, such as names that automatic
captions always get wrong. Each entry is a find → replace pair with its own case and whole-word
options. The dialog shows how many matches each entry has in the current file, and **Apply all**
runs them all as one undo step. **Edit as text** lets you paste a list of `find => replace`
lines. The glossary is saved in this browser.

## 11. Styles, regions and placement

### Styles (WebVTT only)

**Styles…** edits the file's STYLE blocks, which hold CSS for the cues:

- `::cue` styles all cue text.
- `::cue(selector)` styles parts of it: `::cue(i)`, `::cue(.loud)`, `::cue(v[voice="Mary"])`,
  `::cue(:lang(fr))`.
- `::cue-region` styles regions.

Colour, background and font properties are the safest; players support others unevenly.

Type CSS in the box, or use **Add a rule for** to insert a starting rule: every cue, italic or
bold text, each class, voice and language the file uses, and the karaoke and paint-on presets.
Problems in the CSS are listed as you type (click a line number to jump to it), and a preview
draws the selected cue with the styles applied.

### Regions (WebVTT only)

A **region** is a box on the video that cues can be placed in. It is defined by:

- a width and a height in lines;
- a point on the region (the region anchor) pinned to a point on the video (the viewport
  anchor);
- optionally **scroll: up**, which makes new lines push old ones up (see
  [section 14](#14-roll-up-captions)).

Open the Regions dialog from a cue's **Settings → Region → Edit…**. A diagram shows where each
region sits. A cue joins a region through its Region setting. A region no cue uses gets a warning
in Problems, since it does nothing.

## 12. Karaoke and paint-on captions

WebVTT can reveal or highlight a cue word by word using **word timings** (see
[section 5](#word-timing)). The words before the playhead are `:past` and the rest are
`:future`, and a style sheet styles the two differently. Three presets under **Styles… → Add a
rule for** cover the common looks:

- **Words not yet spoken, greyed (karaoke):** the whole line is visible, and spoken words light
  up.
- **Words not yet spoken, hidden (paint-on):** words appear as they are spoken, but the caption
  background is the full line's size from the start.
- **Words not yet spoken, hidden, box growing with them (paint-on):** the background grows with
  the words. To do this, the background moves from the cue onto `<c>` spans, so all the text
  must be inside `<c>` tags.

There is one catch: `:past` and `:future` only reach text inside a tag. MicroVTT watches for this
and offers **Wrap in `<c>`** in the word timing panel, the Styles dialog and the Problems panel
whenever timed or background text is outside a tag. Auto-caption cleanup can also wrap text for
you as it works.

The spec renderer shows paint-on and karaoke faithfully. Browser support varies, and YouTube
does not support them.

## 13. Cleaning up YouTube auto-captions

YouTube's downloadable auto-captions are **roll-up** captions: each line appears in several
overlapping cues as it scrolls up, with word timings from speech recognition. Shown in an
ordinary player, or edited, this is a mess. **Clean up…** rebuilds them as ordinary cues:

1. It takes each caption line once, with its words and timings.
2. It splits the words into readable cues within the limits you set: characters per line, lines
   per cue, shortest and longest cue, reading speed, and a hold before pauses. The limits can
   come from the style guide chosen in the quality panel.
3. It starts a new cue at speaker changes (`>>`), if you ask it to.

Further options:

- keep or drop the word timings;
- keep YouTube's left-aligned positioning;
- tidy spaces, and remove doubled zero-width spaces;
- wrap timed words, or all text, in `<c>` for karaoke or paint-on styles.

The preview shows how many cues become how many, and confirms that every word is kept. Applying
is one undo step.

Afterwards, check the **To review** section of Problems for censored words and sound tags, and
run the **Glossary** for names the recognizer got wrong.

## 14. Roll-up captions

The opposite of cleanup: **Roll-up…** turns ordinary cues into roll-up captions, where each line
appears when it is spoken and is pushed up and out by newer lines, as in live TV captions. It
works on all cues or on a run of selected cues.

Each line of the cues becomes a roll-up line. A line's start time comes from the word timing
before it; without timings, it is spread over its cue by length. A pause between cues longer than
**Clear after a pause of** clears the screen, and the roll starts again.

There are two forms:

- **Scrolling region (WebVTT):** one-line cues in a new `scroll:up` region, **Lines shown** lines
  tall. In Firefox, Safari and the spec renderer, the lines slide up as each one arrives.
  **Background behind each line** (on by default) gives each line its own snug background, as
  pop-on captions have, instead of one dark box the size of the whole region.
- **Repeated lines:** each cue repeats the last few lines, as YouTube's auto-captions do. Every
  player shows this, but nothing slides. It is the only form SRT can hold.

A few things to know:

- Cue settings and ids are not kept; in the region form, the region places the lines.
- Chrome's own renderer ignores regions and stacks the lines newest-on-top.
- YouTube drops regions entirely.
- If you build regions by hand, remember to put the cues _in_ the region. A region no cue uses
  gets a warning in Problems.

## 15. Chapters and metadata files

### Chapters

With **Type: Chapters**, each cue is a chapter and its text is a plain-text title. The
**Chapters** panel replaces the quality panel:

- An **outline** of the chapters, with nested ones indented. Click a chapter to jump to it.
  Chapters that overlap without one containing the other are flagged.
- **Add at playhead** splits the chapter the playhead is in. Without media, **Add chapter**
  appends one.
- **Make continuous** makes each top-level chapter end where the next begins, starting at 0:00.
- **Import a chapter list** reads text like `0:00 Intro` / `1:02:03 - Part two`, the style of
  YouTube video descriptions.
- **Copy as a chapter list** writes the chapters back out in that style, ready to paste into a
  description.

With media loaded, the player shows the current chapter's title.

### Metadata

With **Type: Metadata**, cue text is data for scripts, not for viewers. The field is a monospace
**Payload**. If the payload starts with `{` or `[`, it is checked as JSON, and **Format** / **One
line** re-indent it. Caption-specific checks and tools are turned off.

## 16. Exporting and saving

**Export…** (`Ctrl+S`) writes the document out.

### Options

- **Format:** WebVTT or SubRip. Converting between them lists anything the target cannot hold
  (styles, regions, voices and so on) before you save.
- **File type** (WebVTT).
- **Line endings:** LF or CRLF.
- **Short timestamps** (WebVTT): leaves out the `00:` hours.
- **Byte order mark** and **encoding** (SRT).

### Conformance report

The dialog checks the output and tells you either that the document already conforms, or exactly
which changes export makes so it does ("3 × end time before start time: …"). Warnings that are
valid but suspicious are counted and left alone.

### Player compatibility

Some players misread files that are perfectly valid. These fixes keep the file valid:

- **On by default:** remove cue ids that look like NOTE, STYLE or REGION; write REGION blocks
  first; write characters instead of `&eacute;`-style references.
- **Off by default**, because they change what other players show: strip whitespace-only lines,
  remove `<lang>` spans, remove STYLE and REGION blocks.

### Header lines and YouTube

- **Header lines:** files from YouTube or for HLS streaming carry lines such as `Kind:` or
  `X-TIMESTAMP-MAP=` under `WEBVTT`. Today's spec does not allow them, so export turns them into
  a comment unless you choose to keep them (HLS players need `X-TIMESTAMP-MAP`).
- **Uploading to YouTube?** lists the features in this file and how YouTube treats each one:
  shown as written, shown differently, dropped, or not yet tested. **Tick the fixes for
  YouTube** turns on the fixes that help.

### Saving

- **Chrome and Edge** always ask where to save: **Save as…** opens the system's save dialog. A
  file you opened (and have not renamed) can also be saved back in place (**Save to _name_**).
  If the save dialog cannot open, the dialog offers **Download instead**.
- **Firefox and Safari** cannot be made to ask from a web page: export downloads the file, and
  the browser's own setting decides whether it asks where. To be asked every time, turn on
  "Always ask you where to save files" (Firefox: Settings › General) or set File download
  location to "Ask for each download" (Safari: Settings › General).

Saving marks the document as saved and clears the autosave.

## 17. SubRip (.srt) files

SRT is simpler than WebVTT, and MicroVTT adjusts to it:

- **Markup:** `<i>`, `<b>`, `<u>`, `<s>` (strikethrough), and `<font color>`. There are no
  classes, voices, languages, ruby or word timings.
- **Position:** the `{\an1}`…`{\an9}` tag, set from the Settings Position select.
- **Not available:** styles, regions, ids, the Type select, cleanup, and the scrolling roll-up
  form.
- **Encodings:** older SRT files are often not UTF-8. MicroVTT reads many legacy encodings, and
  export can write the file back in its original encoding, with the original line endings and
  byte order mark.

Converting an SRT to WebVTT (in Export) unlocks the WebVTT tools.

## 18. Autosave, storage and themes

- **Autosave.** While you have unsaved edits, the document is saved in the browser's private
  storage about 1.5 s after each change. If the tab closes, the start screen offers to restore
  it. Saving, exporting or opening another file clears the autosave. Private windows may not
  allow storage; the status area then says "autosave unavailable".
- **Remembered in this browser:** your theme, caption renderer, glossary, quality guide and rule
  changes, and cached waveforms (the 20 most recent media files).
- **Themes:** System (follows your OS's light or dark mode), GitHub Light, Solarized Light,
  Catppuccin Latte, Dracula, One Dark and Nord.

## 19. Keyboard shortcuts

Press **?** in the app for this list. Single-key shortcuts work when you are not typing in a
field. Add **Alt** (Option on a Mac) to use them while typing.

Buttons, checkboxes and section headers you click with the mouse let go of focus afterwards, so
`Space` plays or pauses rather than pressing them again. Reach a control with `Tab` and `Space`
presses it as usual. While tap timing, the **Tap** button keeps focus so `Space` taps.

| Key                                 | Action                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| `Space` / `K`                       | Play or pause                                          |
| `J` / `L`                           | Back / forward 1 second (with Shift: 5 seconds)        |
| `,` / `.`                           | Back / forward one frame                               |
| `[` / `]`                           | Set the cue's start / end to the playhead              |
| `P`                                 | Move the playhead to the mouse pointer on the timeline |
| `R`                                 | Loop the cue on or off                                 |
| `N`                                 | New cue (at the playhead when media is open)           |
| `S`                                 | Split the cue (see [section 4](#4-the-cue-list))       |
| `M`                                 | Merge the selected cues, or the cue with the next one  |
| `Alt+↑` / `Alt+↓`                   | Previous / next cue (plain arrows in the list)         |
| `Ctrl+O`                            | Open a file                                            |
| `Ctrl+S`                            | Export / save                                          |
| `Ctrl+F`                            | Find and replace                                       |
| `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` | Undo, redo                                             |
| `Ctrl+A`                            | Select all cues                                        |
| `Ctrl+I` / `B` / `U`                | Italic, bold, underline (in the cue text)              |
| `Enter` (in the list)               | Edit the cue's text                                    |
| `Delete` (in the list)              | Delete the selected cues                               |
| `↑` / `↓` in a time field           | Nudge by 0.1 s (with Shift: 1 s)                       |
| `Alt` while dragging                | Don't snap on the timeline                             |
| `Ctrl+scroll`                       | Zoom the timeline                                      |

## 20. The single-file build

`pnpm build:single` produces `apps/web/dist-single/microvtt.html`: the whole editor in one HTML
file that you can pass around and open straight from disk, with no server and no install. It
works the same as the hosted app, with a few limits that come from opening a file from disk:

- **Autosave** may be unavailable, depending on the browser. The status area says so.
- **Saving** works as in the hosted app: Chrome and Edge ask where to save, and Firefox and
  Safari download.
- It does not update itself: hand out a fresh copy when the app changes.
