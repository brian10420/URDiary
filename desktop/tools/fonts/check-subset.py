#!/usr/bin/env python3
"""Verify the vendored Font Awesome woff2 subset has a glyph for every
`.fa-*::before { content: "\\fXXX" }` rule in fontawesome-subset.css.
Usage: python3 desktop/tools/fonts/check-subset.py   (needs fontTools + brotli; system python3 has both)
Re-subset: python3 -m fontTools.subset fa-solid-900.ttf --unicodes=U+F013,... --flavor=woff2 \
  --no-hinting --desubroutinize --output-file=assets/vendor/fontawesome/webfonts/fa-solid-900.woff2
"""
import re, sys, pathlib
from fontTools.ttLib import TTFont

base = pathlib.Path(__file__).resolve().parents[2] / 'assets/vendor/fontawesome'
css = (base / 'fontawesome-subset.css').read_text(encoding='utf-8')
wanted = {int(h, 16) for h in re.findall(r'content:\s*"\\([0-9a-fA-F]+)"', css)}
have = set(TTFont(base / 'webfonts/fa-solid-900.woff2').getBestCmap())
missing = sorted(wanted - have)
print(f'{len(wanted)} css codepoints, {len(have)} glyphs in font')
if missing:
    print('MISSING glyphs:', [hex(c) for c in missing]); sys.exit(1)
print('OK')
