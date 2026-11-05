#!/usr/bin/env python3
"""Regenerate browser icons from the approved logo; requires Pillow."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
source = Image.open(ROOT / 'assets/branding/passel-logo.png').convert('RGBA')
# Approved1254px artwork: herd ends at818; the wordmark begins below834.
# Crop the herd only; keep the full original artwork as the brand master.
herd = source.crop((0, 0, source.width, 825))
bounds = herd.getchannel('A').point(lambda value: 255 if value > 16 else 0).getbbox()
assert bounds
herd = herd.crop(bounds)
public = ROOT / 'web/public'
header_mark = herd.copy()
header_mark.thumbnail((176, 128), Image.Resampling.LANCZOS)
header_mark.save(public / 'passel-mark.png', optimize=True)

def icon(size, scale):
    result = Image.new('RGBA', (size, size), '#f7f3ee')
    mark = herd.copy()
    mark.thumbnail((round(size * scale), round(size * scale)), Image.Resampling.LANCZOS)
    result.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return result.convert('RGB')

for size in (32, 180, 192, 512):
    icon(size, .9).save(public / f'passel-icon-{size}.png', optimize=True)
for size in (192, 512):
    icon(size, .68).save(public / f'passel-icon-maskable-{size}.png', optimize=True)
