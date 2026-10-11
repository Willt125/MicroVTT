/**
 * Where the spec renderer differs from WPT's WebVTT rendering references, by test name (its path
 * under tests/wpt/rendering, without ".html"), and why.
 */

/** References that are wrong, or test what the renderer cannot: the test must fail. */
export const EXPECTED_FAILURES: Record<string, string> = {
  line_integer_and_percent_mixed_overlap:
    'The reference draws the first cue without the test page’s Ahem font.',
  line_integer_and_percent_mixed_overlap_move_up:
    'The reference draws the first cue without the test page’s Ahem font.',
  line_percent_and_integer_mixed_overlap:
    'The reference draws the first cue without the test page’s Ahem font.',
  line_percent_and_integer_mixed_overlap_move_up:
    'The reference draws the first cue without the test page’s Ahem font.',
  ...Object.fromEntries(
    ['class', 'italic', 'underline', 'voice'].map((o) => [
      `selectors/cue_function/${o}_object/${o}_animation_with_timestamp`,
      'The reference, copied from the bold test’s, draws the text bold.',
    ]),
  ),
  'bidi/start_alignment':
    'The reference spreads the cue over the whole width; for start alignment the spec puts the cue’s position at 50% with line-left position alignment (§7.2), the right half.',
  'bidi/u002E_LF_u05D0':
    'The reference gives the second line a left-to-right base direction, though its first strong character, U+05D0, is right-to-left; the spec takes each line’s base direction from its first strong character (unicode-bidi: plaintext, §3.1).',
  'bidi/u002E_u2029_u05D0':
    'The reference gives the second line a left-to-right base direction, though its first strong character, U+05D0, is right-to-left; the spec takes each line’s base direction from its first strong character (unicode-bidi: plaintext, §3.1).',
  'bidi/u002E_u2028_u05D0':
    'The reference breaks the line at U+2028 LINE SEPARATOR; the browser’s CSS line breaking (white-space: pre-line) does not.',
  'selectors/cue-region/font_properties':
    'The reference expects the region’s font-family (!important) to override the cue’s own (set by ::cue); a cue inherits from its region only what it does not set itself, whatever the region’s importance (CSS Cascade).',
  'selectors/cue-region_function/font_properties':
    'The region’s line-height (18px) is taller than its one line of 6vh (10.8px), so the spec’s region clips the cue (§7.4, overflow: hidden); the reference draws the whole line, and the region without its background.',
  ...Object.fromEntries(
    [
      'bidi/vertical_lr',
      'bidi/vertical_rl',
      'selectors/cue/vertical_ruby-position',
      'selectors/cue/vertical_text-combine-upright',
      'selectors/cue_function/class_object/class_vertical_text-combine-upright',
    ].map((name) => [
      name,
      'The reference puts the vertical cue at the bottom of the video; the spec gives it the full height (size 100%, position 50%, §7.2) and centres its text (text-align: center).',
    ]),
  ),
  decode_escaped_entities:
    'The reference breaks the line by hand after “escaped”; the spec’s text-wrap: balance (§7.4) picks another break, and so does greedy wrapping.',
  'portrait.tentative':
    'Tests a proposal (w3c/webvtt#529) to size cue text by 5vmin; the spec says 5vh.',
  'selectors/cue/fontsize_smaller_than_container.tentative':
    'Tests a proposal (w3c/webvtt#530) to set the cue box’s own font size to 0, so that lines with a smaller ::cue font are packed tighter; the spec sets it to 5vh (§7.4).',
  'regions/scroll_up':
    'The test pauses the video as soon as it plays, when only the first cue is active, but the reference draws the second and third.',
  'regions/single_line_top_left':
    'The cue is shorter than the region’s one 6vh line, so the spec moves the region down by the difference (§7.1), 1.8px; the reference keeps it at the top.',
  embedded_style_selectors:
    'The track has no blank lines, so its STYLE block is part of the NOTE before it (§6.1) and does not apply; the reference assumes it does.',
  embedded_style_urls:
    'The track has no blank lines, so its STYLE block is part of the NOTE before it (§6.1) and does not apply; the reference assumes it does.',
  ...Object.fromEntries(
    [
      'selectors/cue/white-space_pre-wrap_wrapped',
      'selectors/cue_function/white-space_pre-wrap_wrapped',
      ...['bold', 'class', 'italic', 'underline', 'voice'].map(
        (o) => `selectors/cue_function/${o}_object/${o}_white-space_pre-wrap_wrapped`,
      ),
    ].map((name) => [
      name,
      'Under the pre-wrap the test sets, white space at the end of a wrapped line hangs (CSS Text 3 §4.1.3) and the browser does not paint it past the line end; the reference sets it with white-space: pre, where it takes up room.',
    ]),
  ),
};

interface Adjustment {
  reason: string;
  /** CSS added to the rendering. */
  css: string;
  /** Pixels allowed to differ instead of the usual few, when the reason accounts for them. */
  tolerance?: number;
}

const both = (a: Adjustment, b: Adjustment): Adjustment => ({
  reason: `${a.reason} ${b.reason}`,
  css: `${a.css} ${b.css}`,
});

const NO_REGION_BACKGROUND: Adjustment = {
  reason:
    'The reference draws the region without the dark background the spec gives regions (§7.4); with that background removed, it matches.',
  css: '.vtt-region { background: transparent !important; }',
};

/** The reference's line of text sits a fraction of a pixel higher than in a region's line box. */
const REGION_SUBPIXEL: Adjustment = {
  ...NO_REGION_BACKGROUND,
  reason: `${NO_REGION_BACKGROUND.reason} One row of anti-aliased pixels at the top of the text still differs: the reference's line box, not being a region's, puts the text 0.2px higher.`,
  tolerance: 320,
};

const NO_BALANCE: Adjustment = {
  reason:
    'The reference fills lines greedily; the spec balances the lines of a wrapped cue (§7.4, text-wrap: balance). Wrapping greedily, it matches.',
  css: '.vtt-cue { text-wrap: wrap !important; }',
};

const CLIPPED: Adjustment = {
  reason:
    'The reference clips the cue box (overflow: hidden), which the spec does not ask for. Clipped, it matches.',
  css: '.vtt-cue { overflow: hidden !important; }',
};

const NO_OPACITY: Adjustment = {
  reason:
    'The reference ignores opacity, which the spec allows on ::cue() (§8.2.1). Without it, it matches.',
  css: '.vtt-cue, .vtt-node { opacity: 1 !important; }',
};

const ANIMATION_ENDED: Adjustment = {
  reason:
    'The reference draws the animation’s last keyframe, but the screenshot is taken about a second into the 9s animation (steps(2, start): halfway). With the animation run to its end, it matches.',
  css: '.vtt-node { animation-delay: -9s !important; animation-fill-mode: forwards !important; }',
};

const NO_RUBY_BACKGROUND: Adjustment = {
  reason:
    'The reference draws ruby text without the background the spec gives it (§7.4). Without it, it matches.',
  css: '.vtt-cue rt { background: transparent !important; }',
};

const CENTRED_ON_LINE: Adjustment = {
  reason:
    'The reference keeps the page’s default 8px body margin, which moves everything 8px right and down, and centres the cues on line 50%, as line alignment center would; the cues’ line alignment is start, which puts their top edge there (§7.2). Moved by the margin and up half a line (4.5px), it matches.',
  css: '.vtt-track { translate: 8px 8px; } .vtt-cue { margin-top: -4.5px !important; }',
};

const objects = ['bold', 'class', 'italic', 'underline', 'voice'];

/**
 * References that differ from the spec in one stated way: the test renders with that difference
 * applied (CSS added to the rendering) and must then match.
 */
export const ADJUSTED: Record<string, Adjustment> = {
  'regions/basic': REGION_SUBPIXEL,
  'regions/regionanchor_x_50_percent': REGION_SUBPIXEL,
  'regions/regionanchor_y_50_percent': NO_REGION_BACKGROUND,
  'regions/viewportanchor_x_50_percent': REGION_SUBPIXEL,
  'regions/viewportanchor_y_50_percent': REGION_SUBPIXEL,
  'regions/width_50_percent': { ...both(NO_REGION_BACKGROUND, NO_BALANCE), tolerance: 320 },
  'bidi/bidi_ruby': NO_RUBY_BACKGROUND,
  'evil/9_cues_overlapping_completely': CENTRED_ON_LINE,
  'evil/9_cues_overlapping_completely_all_cues_have_same_timestamp': CENTRED_ON_LINE,
  'selectors/cue/font_properties': NO_BALANCE,
  'selectors/cue/font_shorthand': NO_BALANCE,
  'selectors/cue_function/font_properties': NO_BALANCE,
  'selectors/cue_function/font_shorthand': NO_BALANCE,
  'selectors/cue/white-space_pre_wrapped': CLIPPED,
  'selectors/cue_function/white-space_pre_wrapped': CLIPPED,
  'selectors/cue_function/not_allowed_properties': NO_OPACITY,
  'selectors/cue_function/bold_object/bold_animation_with_timestamp': ANIMATION_ENDED,
  ...Object.fromEntries(
    objects.flatMap((o) => [
      [`selectors/cue_function/${o}_object/${o}_white-space_normal_wrapped`, NO_BALANCE],
      [`selectors/cue_function/${o}_object/${o}_white-space_pre-line_wrapped`, NO_BALANCE],
      [`selectors/cue_function/${o}_object/${o}_white-space_pre_wrapped`, CLIPPED],
    ]),
  ),
};

/** Tests that need what the harness does not draw (beyond those found automatically). */
export const NOT_APPLICABLE: Record<string, string> = {
  'evil/media_404_omit_subtitles':
    'The video fails to load, so the browser shows no cues; the renderer is given no media.',
  'selectors/cue/inherit_values_from_media_element':
    'Styles the video element itself, which the harness does not draw.',
  'selectors/cue_function/inherit_values_from_media_element':
    'Styles the video element itself, which the harness does not draw.',
  'selectors/default_styles/inherit_as_default_value_inherits_values_from_media_element':
    'Styles the video element itself, which the harness does not draw.',
};
