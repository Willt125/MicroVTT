/**
 * The WebVTT rendering rules (spec §7), drawn with the browser's CSS engine into an element the
 * size of the video's rendering area: each active cue's box is sized and placed by the cue
 * settings (core's render.ts), laid out, then moved line by line (or to the nearest free place)
 * so that cues do not overlap; regions stack their cues from the bottom. Styles come from the
 * page and from the tracks' STYLE blocks (core's cue-css.ts).
 *
 * The DOM, per track: `.vtt-track` > (`.vtt-region` >) `.vtt-cue` > `.vtt-bg` > nodes, where
 * nodes are elements named as WebVTT names them (c, i, b, u, ruby, rt, v, lang, with the class
 * `vtt-node`) and text.
 */
import {
  REGION_LINE_HEIGHT,
  activeCues,
  cueBoxSettings,
  cueInRegionLeft,
  parseCueText,
  regionBoxSettings,
  scopeCueStylesheet,
  type Cue,
  type CueNode,
  type Region,
} from '@microvtt/core';

export interface RenderTrack {
  cues: readonly Cue[];
  regions: readonly Region[];
  /** The track's STYLE blocks. */
  styles: readonly string[];
  /** The track's language: that of cue text that does not name one. */
  language?: string | undefined;
}

export interface RenderOptions {
  /** Style sheets of the page the video is in: their ::cue rules apply before the tracks' own. */
  pageCss?: string;
}

/**
 * The spec's defaults (§7.4), in a cascade layer so that every ::cue rule overrides them, as
 * rules at the user agent level would be. Font sizes are in `--vtt-vh` (1% of the area's height).
 */
const DEFAULT_CSS = `@layer vtt-default, vtt-important, vtt-page, vtt-normal;
@layer vtt-default {
  .vtt-track { all: initial; display: block; position: absolute; inset: 0; pointer-events: none; }
  .vtt-cue {
    position: absolute; unicode-bidi: plaintext; overflow-wrap: break-word; text-wrap: balance;
    white-space: pre-line; color: rgba(255, 255, 255, 1);
    font: calc(5 * var(--vtt-vh)) sans-serif;
  }
  .vtt-bg, .vtt-cue rt { background: rgba(0, 0, 0, 0.8); }
  .vtt-cue i { font-style: italic; }
  .vtt-cue b { font-weight: bold; }
  .vtt-cue u { text-decoration: underline; }
  .vtt-cue ruby { display: ruby; }
  .vtt-cue rt { display: ruby-text; }
  .vtt-region {
    position: absolute; writing-mode: horizontal-tb; background: rgba(0, 0, 0, 0.8);
    overflow-wrap: break-word; font: calc(5 * var(--vtt-vh)) sans-serif;
    color: rgba(255, 255, 255, 1); overflow: hidden; min-height: 0; display: inline-flex;
    flex-flow: column; justify-content: flex-end;
  }
  .vtt-region > .vtt-cue { position: relative; width: auto; font: inherit; color: inherit; }
  .vtt-node[data-vtt-color] { color: var(--vtt-color); }
  .vtt-node[data-vtt-background] { background: var(--vtt-background); }
}`;

/** The default text and background colour classes (§5), as presentational hints. */
const CLASS_COLORS = new Map(
  Object.entries({
    white: 'rgba(255,255,255,1)',
    lime: 'rgba(0,255,0,1)',
    cyan: 'rgba(0,255,255,1)',
    red: 'rgba(255,0,0,1)',
    yellow: 'rgba(255,255,0,1)',
    magenta: 'rgba(255,0,255,1)',
    blue: 'rgba(0,0,255,1)',
    black: 'rgba(0,0,0,1)',
  }),
);

/**
 * Sets the colour classes' presentational hints on a node: below every style sheet (they are in
 * the default layer), and the later class wins when several apply.
 */
function colorHints(el: HTMLElement, classes: readonly string[]): void {
  for (const name of classes) {
    const background = name.startsWith('bg_');
    const value = CLASS_COLORS.get(background ? name.slice(3) : name);
    if (value === undefined) continue;
    const key = background ? 'background' : 'color';
    el.dataset[background ? 'vttBackground' : 'vttColor'] = '';
    el.style.setProperty(`--vtt-${key}`, value);
  }
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EPSILON = 0.01;
const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right - EPSILON &&
  b.left < a.right - EPSILON &&
  a.top < b.bottom - EPSILON &&
  b.top < a.bottom - EPSILON;
const within = (a: Rect, area: Rect): boolean =>
  a.left >= area.left - EPSILON &&
  a.top >= area.top - EPSILON &&
  a.right <= area.right + EPSILON &&
  a.bottom <= area.bottom + EPSILON;

/** Elements that `:past` and `:future` classes are kept up to date on. */
interface TimedElement {
  el: Element;
  /** Pre-order positions of the node's start and end. */
  start: number;
  end: number;
}

interface BuiltCue {
  root: HTMLElement;
  timed: TimedElement[];
  /** Timestamps by pre-order position. */
  stamps: { at: number; ms: number }[];
}

/** Builds a cue's DOM from its text (§7.3 "Obtaining CSS boxes"). */
function buildCue(cue: Cue, language: string | undefined): BuiltCue {
  const tree = parseCueText(cue.text, language);
  const root = document.createElement('div');
  root.className = 'vtt-cue';
  if (cue.id) root.dataset['vttId'] = cue.id;
  if (tree.language) root.setAttribute('lang', tree.language);
  const bg = document.createElement('span');
  bg.className = 'vtt-bg';
  root.append(bg);

  const timed: TimedElement[] = [];
  const stamps: { at: number; ms: number }[] = [];
  const hasStamps = /<[0-9]/.test(cue.text);
  let position = 0;
  const add = (parent: Element, nodes: CueNode[]): void => {
    for (const node of nodes) {
      const start = position++;
      if (node.type === 'timestamp') {
        stamps.push({ at: start, ms: node.ms });
        continue;
      }
      if (node.type === 'text') {
        if (hasStamps) {
          // Text between timestamps in a span, so that :past and :future can style it.
          const span = document.createElement('span');
          span.className = 'vtt-text';
          span.textContent = node.value;
          parent.append(span);
          timed.push({ el: span, start, end: start });
        } else parent.append(node.value);
        continue;
      }
      const el = document.createElement(node.type);
      el.classList.add('vtt-node', ...node.classes);
      colorHints(el, node.classes);
      if (node.type === 'v') el.setAttribute('voice', node.annotation);
      if (node.type === 'lang' && node.language) el.setAttribute('lang', node.language);
      parent.append(el);
      add(el, node.children);
      timed.push({ el, start, end: position - 1 });
    }
  };
  add(bg, tree.children);
  timed.push({ el: root, start: -1, end: position });
  return { root, timed, stamps };
}

/** Marks nodes in the past or future of `timeMs` (§8.2.3). */
function markTime(built: BuiltCue, timeMs: number): void {
  if (built.stamps.length === 0) return;
  for (const { el, start, end } of built.timed) {
    el.classList.toggle(
      'vtt-past',
      built.stamps.some((s) => s.at > end && s.ms < timeMs),
    );
    el.classList.toggle(
      'vtt-future',
      built.stamps.some((s) => s.at < start && s.ms > timeMs),
    );
  }
}

/** Renders text tracks into an element the size of the video's rendering area. */
export class CueRenderer {
  private readonly container: HTMLElement;
  private built: BuiltCue[] = [];
  private key: unknown[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Draws the cues active at `timeMs`. Cheap when nothing but :past/:future changed. */
  render(tracks: readonly RenderTrack[], timeMs: number, options: RenderOptions = {}): void {
    const active = tracks.map((t) => activeCues(t.cues, timeMs));
    const key = [
      this.container.clientWidth,
      this.container.clientHeight,
      options.pageCss,
      ...tracks.flatMap((t, i) => [t.styles, t.regions, t.language, ...(active[i] as Cue[])]),
    ];
    if (key.length !== this.key.length || key.some((k, i) => k !== this.key[i])) {
      this.key = key;
      this.layout(tracks, active, options, timeMs);
    } else {
      for (const built of this.built) markTime(built, timeMs);
    }
  }

  /** Removes everything drawn. */
  clear(): void {
    this.container.replaceChildren();
    this.built = [];
    this.key = [];
  }

  private layout(
    tracks: readonly RenderTrack[],
    active: Cue[][],
    options: RenderOptions,
    timeMs: number,
  ): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.container.style.setProperty('--vtt-vh', `${height / 100}px`);
    this.container.style.setProperty('--vtt-vw', `${width / 100}px`);
    const scope = (i: number): string => `[data-vtt-track="${i}"]`;
    // One style element per sheet, so that a broken sheet cannot spill into the next. STYLE
    // blocks come after the page's style sheets in the cascade (§8), and win over them whatever
    // the page's cascade layers: their normal declarations in a layer after the page's, their
    // !important ones in a layer before it (where !important wins).
    const layered = (layer: string, css: string): string => css && `@layer ${layer} { ${css} }`;
    const embedded = (importance: 'normal' | 'important'): string[] =>
      tracks.flatMap((t, i) =>
        t.styles.map((css) =>
          layered(`vtt-${importance}`, scopeCueStylesheet(css, scope(i), true, importance)),
        ),
      );
    const sheets = [
      DEFAULT_CSS,
      ...embedded('important'),
      ...tracks.map((_, i) =>
        layered('vtt-page', scopeCueStylesheet(options.pageCss ?? '', scope(i), false)),
      ),
      ...embedded('normal'),
    ].filter((css) => css !== '');
    this.container.replaceChildren(
      ...sheets.map((css) => Object.assign(document.createElement('style'), { textContent: css })),
    );
    this.built = [];
    if (width === 0 || height === 0) return;

    // Boxes are placed in the container's padding box: measure from there, not from its border.
    const bounds = this.container.getBoundingClientRect();
    const origin = {
      left: bounds.left + this.container.clientLeft,
      top: bounds.top + this.container.clientTop,
    };
    const rectOf = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - origin.left,
        top: r.top - origin.top,
        right: r.right - origin.left,
        bottom: r.bottom - origin.top,
      };
    };
    const area: Rect = { left: 0, top: 0, right: width, bottom: height };
    const output: (Rect | (() => Rect))[] = [];
    const placed = (): Rect[] => output.map((r) => (typeof r === 'function' ? r() : r));

    tracks.forEach((track, trackIndex) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'vtt-track';
      wrapper.dataset['vttTrack'] = String(trackIndex);
      this.container.append(wrapper);

      // Region boxes, for the regions this track's active cues are in.
      const regionBoxes = new Map<string, { el: HTMLElement; region: Region; top: number }>();
      for (const region of track.regions) {
        if (!(active[trackIndex] as Cue[]).some((c) => c.region === region.id)) continue;
        const box = regionBoxSettings(region);
        const el = document.createElement('div');
        el.className = 'vtt-region';
        el.dataset['vttRegionId'] = region.id;
        el.style.width = `${(box.width * width) / 100}px`;
        el.style.maxHeight = `${(box.height * height) / 100}px`;
        el.style.left = `${(box.left * width) / 100}px`;
        el.style.top = `${(box.top * height) / 100}px`;
        wrapper.append(el);
        regionBoxes.set(region.id, { el, region, top: (box.top * height) / 100 });
        output.push(() => rectOf(el));
      }

      for (const cue of active[trackIndex] as Cue[]) {
        const built = buildCue(cue, track.language);
        markTime(built, timeMs);
        const inRegion = cue.region === null ? undefined : regionBoxes.get(cue.region);
        if (inRegion) {
          built.root.style.left = `${cueInRegionLeft(cue, inRegion.region)}%`;
          built.root.style.textAlign = cueBoxSettings(cue, trackIndex).textAlign;
          inRegion.el.append(built.root);
          if (built.root.querySelector('.vtt-bg')?.getClientRects().length === 0) {
            built.root.remove();
            continue;
          }
          this.built.push(built);
          continue;
        }
        if (this.placeCue(cue, trackIndex, built, wrapper, width, height, area, rectOf, placed))
          output.push(rectOf(built.root));
      }

      // A region whose cues are shorter than it is moves down by the difference (§7.1).
      for (const { el, region, top } of regionBoxes.values()) {
        const full = (REGION_LINE_HEIGHT * region.lines * height) / 100;
        const diff = full - el.getBoundingClientRect().height;
        if (diff > 0) el.style.top = `${top + diff}px`;
      }
    });
  }

  /** Lays out and places one cue outside regions (§7.2); false if it was dropped. */
  private placeCue(
    cue: Cue,
    trackIndex: number,
    built: BuiltCue,
    wrapper: HTMLElement,
    width: number,
    height: number,
    area: Rect,
    rectOf: (el: Element) => Rect,
    placed: () => Rect[],
  ): boolean {
    const settings = cueBoxSettings(cue, trackIndex);
    const horizontal = settings.writingMode === 'horizontal-tb';
    const root = built.root;
    root.style.writingMode = settings.writingMode;
    root.style.textAlign = settings.textAlign;
    if (horizontal) root.style.width = `${(settings.size * width) / 100}px`;
    else root.style.height = `${(settings.size * height) / 100}px`;
    let x = (settings.x * width) / 100;
    let y = (settings.y * height) / 100;
    const apply = (): void => {
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
    };
    apply();
    wrapper.append(root);

    const bg = root.querySelector('.vtt-bg') as HTMLElement;
    const lines = bg.getClientRects();
    if (lines.length === 0 || root.textContent === '') {
      root.remove();
      return false;
    }
    const others = placed();
    const free = (r: Rect): boolean => within(r, area) && !others.some((o) => overlaps(r, o));

    // Positions along the line axis are handled in "flow" coordinates, measured from the side
    // lines are counted from: the top, the left (vertical-lr) or the right (vertical-rl).
    const rl = settings.writingMode === 'vertical-rl';
    const full = horizontal ? height : width;
    const flow = (r: Rect): Rect =>
      horizontal
        ? r
        : rl
          ? { left: width - r.right, right: width - r.left, top: r.top, bottom: r.bottom }
          : r;
    const box = (): Rect => flow(rectOf(root));
    const start = (r: Rect): number => (horizontal ? r.top : r.left);
    const end = (r: Rect): number => (horizontal ? r.bottom : r.right);
    const move = (d: number): void => {
      if (horizontal) y += d;
      else x += rl ? -d : d;
      apply();
    };

    if (cue.snapToLines) {
      // The line pitch: from one line box to the next, or the one line's extent.
      const first = lines[0] as DOMRect;
      const second = lines[1];
      const bounds = box();
      const extent = end(bounds) - start(bounds);
      let step = second
        ? Math.abs(horizontal ? second.top - first.top : second.left - first.left)
        : extent;
      if (step > 0) {
        // Vertical lines count from the right (rl) or left (lr); "auto" is the first line there.
        // (The spec's steps for vertical cues put them on the opposite side; browsers and WPT
        // do not.) A negative line puts the box's last line box on that line from the end.
        const line = Math.floor((horizontal || cue.line !== 'auto' ? settings.line : 0) + 0.5);
        let position = step * line;
        if (line < 0) {
          position += full - (extent - step);
          step = -step;
        }
        move(position - start(bounds));
        const specified = { x, y };
        const firstLine = (r: Rect): [number, number] => [start(r), start(r) + Math.abs(step)];
        let switched = false;
        // Enough steps to cross the area and the box itself, both ways.
        const limit = (Math.ceil((full + extent) / Math.abs(step)) + 2) * 2;
        for (let i = 0; i < limit; i++) {
          const r = box();
          if (free(rectOf(root))) break;
          const [a, b] = firstLine(r);
          if ((step < 0 && a < -EPSILON) || (step > 0 && b > full + EPSILON)) {
            if (switched) {
              root.remove();
              return false;
            }
            x = specified.x;
            y = specified.y;
            apply();
            step = -step;
            switched = true;
            continue;
          }
          move(step);
        }
      }
    } else {
      const bounds = box();
      const extent = end(bounds) - start(bounds);
      // Percent lines measure from the top or left, as do the box's settings.
      const shift = (d: number): void => {
        if (horizontal) y += d;
        else x += d;
        apply();
      };
      if (cue.lineAlign === 'center') shift(-extent / 2);
      else if (cue.lineAlign === 'end') shift(-extent);
      const r = rectOf(root);
      if (!free(r)) {
        // The closest place where the box overlaps nothing and stays inside the area; the
        // higher, then the more leftward, wins a tie (§7.2). Candidates line the box up with
        // another box's edge or the area's on each axis.
        const w = r.right - r.left;
        const h = r.bottom - r.top;
        const xs = [r.left, area.left, area.right - w];
        const ys = [r.top, area.top, area.bottom - h];
        for (const o of others) xs.push(o.right, o.left - w);
        for (const o of others) ys.push(o.bottom, o.top - h);
        let best: { dx: number; dy: number; distance: number } | null = null;
        for (const left of xs) {
          for (const top of ys) {
            const candidate = { left, top, right: left + w, bottom: top + h };
            if (!free(candidate)) continue;
            const dx = left - r.left;
            const dy = top - r.top;
            const distance = Math.hypot(dx, dy);
            if (
              !best ||
              distance < best.distance - EPSILON ||
              (Math.abs(distance - best.distance) <= EPSILON &&
                (top < r.top + best.dy - EPSILON ||
                  (Math.abs(top - r.top - best.dy) <= EPSILON && dx < best.dx)))
            )
              best = { dx, dy, distance };
          }
        }
        if (best) {
          x += best.dx;
          y += best.dy;
          apply();
        }
      }
    }
    this.built.push(built);
    return true;
  }
}
