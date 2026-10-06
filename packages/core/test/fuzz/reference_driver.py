"""
Runs WPT's reference WebVTT parser (tests/wpt/file-parsing/reference-parser.py) over JSON-encoded
inputs read from stdin (one JSON string per line) and prints one JSON result per line.

The vendored reference parser is not a faithful translation of the spec in a few places, so the
source is patched at load time. Each patch is asserted to apply, so an upstream change that
fixes or moves the code fails loudly instead of silently changing what we compare against.
"""
import json
import re
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[4] / 'tests/wpt/file-parsing/reference-parser.py'

PATCHES = [
    # re.split() with a pattern that can match the empty string splits between every character
    # (Python 3.7+), so no setting would ever be recognized. Spec: "split a string on spaces".
    (r'SPACE_SPLIT_PATTERN = r"[{}]*"', r'SPACE_SPLIT_PATTERN = r"[{}]+"'),
    # Spec §6.3 "collect a WebVTT timestamp": error only if value2 or value3 is *greater than* 59.
    ('if value_2 >= 59 or value_3 >= 59:', 'if value_2 > 59 or value_3 > 59:'),
    # \d and \s match non-ASCII digits and spaces; the spec only allows ASCII.
    (r"re.match(r'^\d+(\.\d+)?%$', input)", r"re.fullmatch(r'[0-9]+(\.[0-9]+)?%', input)"),
    (r"re.match(r'^STYLE\s*$', buffer)", r"re.fullmatch(r'STYLE[ \t\n\f\r]*', buffer)"),
    (r"re.match(r'^REGION\s*$', buffer)", r"re.fullmatch(r'REGION[ \t\n\f\r]*', buffer)"),
    (r"re.match(r'^\d+$', value)", r"re.fullmatch(r'[0-9]+', value)"),
    (r"re.search(r'\d', linepos)", r"re.search(r'[0-9]', linepos)"),
    (r"re.match(r'^[-\.\d]*$', linepos)", r"re.fullmatch(r'[-.0-9]*', linepos)"),
    (r"re.search(r'\d\.\d', linepos)", r"re.search(r'[0-9]\.[0-9]', linepos)"),
    # HTML "rules for parsing floating-point number values": never -0, and overflow is an error.
    ('                    number = float(linepos)\n',
     '                    number = float(linepos) + 0.0\n'
     "                    if number in (float('inf'), float('-inf')):\n"
     '                        continue\n'),
    # Position alignment is assigned to the line alignment field by mistake.
    ("self.cue.line_alignment = 'line-left'", "self.cue.position_alignment = 'line-left'"),
    ("self.cue.line_alignment = 'line-right'", "self.cue.position_alignment = 'line-right'"),
    ("                elif colalign == \"center\":\n                    self.cue.line_alignment = 'center'",
     "                elif colalign == \"center\":\n                    self.cue.position_alignment = 'center'"),
    # Spec §6.3: vertical, line and (non-100) size settings take the cue out of its region.
    ("                    self.cue.writing_direction = value\n",
     "                    self.cue.writing_direction = value\n"
     "                if self.cue.writing_direction != 'horizontal':\n"
     "                    self.cue.region = None\n"),
    ("                    self.cue.snap_to_lines = True\n",
     "                    self.cue.snap_to_lines = True\n"
     "                self.cue.region = None\n"),
    ("                self.cue.cue_size = number\n",
     "                self.cue.cue_size = number\n"
     "                if number != 100:\n"
     "                    self.cue.region = None\n"),
]


def load_reference():
    source = SOURCE.read_text()
    for old, new in PATCHES:
        count = source.count(old)
        if count != 1:
            raise SystemExit(f'reference patch matched {count} times: {old!r}')
        source = source.replace(old, new)
    namespace = {'__name__': 'reference_parser'}
    exec(compile(source, str(SOURCE), 'exec'), namespace)
    return namespace['VTTParser']


def region_json(region):
    return {
        'id': region.id,
        'width': region.width,
        'lines': region.lines,
        'regionAnchorX': region.anchor_point[0],
        'regionAnchorY': region.anchor_point[1],
        'viewportAnchorX': region.viewport_anchor_point[0],
        'viewportAnchorY': region.viewport_anchor_point[1],
        'scroll': region.scroll_value or '',
    }


def strip_alignment(value):
    return value.replace(' alignment', '')


def main():
    VTTParser = load_reference()
    for raw in sys.stdin:
        parser = VTTParser(json.loads(raw))
        parser.parse()
        ok = not any(e in ('input too small for webvtt', 'invalid webvtt header') for e in parser.errors)
        cues = []
        for cue in parser.text_tracks:
            cues.append({
                'id': cue.id,
                'start': cue.start_time,
                'end': cue.end_time,
                'region': region_json(cue.region) if cue.region else None,
                'vertical': '' if cue.writing_direction == 'horizontal' else cue.writing_direction,
                'snapToLines': cue.snap_to_lines,
                'line': cue.line,
                'lineAlign': strip_alignment(cue.line_alignment),
                'position': cue.position,
                'positionAlign': strip_alignment(cue.position_alignment),
                'size': cue.cue_size,
                'align': cue.text_alignment,
                'text': cue.text,
            })
        print(json.dumps({
            'ok': ok,
            'cues': cues if ok else [],
            'regions': [region_json(r) for r in parser.regions] if ok else [],
            'stylesheets': [s.source for s in parser.stylesheets] if ok else [],
        }))


if __name__ == '__main__':
    main()
