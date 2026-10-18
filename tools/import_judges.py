# Copies each judge set's POOR image (F_PR.png) and the judge.lua values the
# empty POOR overlay needs from a beatoraja simple-play skin.
#
#   python tools/import_judges.py "<beatoraja>/skin/<simple-play>/customize/judge"
#
# The images come from many different skins, so they are not kept in the repo.
import json, os, re, shutil, sys
from PIL import Image

if len(sys.argv) < 2:
    sys.exit(__doc__ or 'usage: import_judges.py <customize/judge folder> [output folder]')
src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'lr2hp-for-osu-emptypoor', 'skins', 'judge')

DEFAULTS = {
    'JUDGEF_WIDTH': 180, 'JUDGEF_HEIGHT': 50, 'DIVY_F_PR': 1,
    'JUDGE_ANIMATION_CYCLE_PR': 75, 'JUDGE_SCALE_ANIMATION_TIME': 100,
    'JUDGEF_SCALE_ANIMATION_WIDTH': 0, 'JUDGEF_SCALE_ANIMATION_HEIGHT': 0,
    'JUDGEF_SCALE_ANIMATION_OPACITY': 255,
}

def lua_numbers(text):
    text = re.sub(r'--\[\[.*?\]\]', '', text, flags=re.S)
    text = re.sub(r'--[^\n]*', '', text)
    return {k: float(v) for k, v in re.findall(r'([A-Z_]+)\s*=\s*(-?[\d.]+)', text)}

sets = {}
for name in sorted(os.listdir(src)):
    folder = os.path.join(src, name)
    pr = os.path.join(folder, 'F_PR.png')
    lua = os.path.join(folder, 'judge.lua')
    if not (os.path.isfile(pr) and os.path.isfile(lua)):
        continue
    with open(lua, encoding='utf-8', errors='replace') as f:
        values = {**DEFAULTS, **lua_numbers(f.read())}
    w, h = Image.open(pr).size
    if w < 4 or h < 4:
        continue
    safe = re.sub(r'[^A-Za-z0-9_-]+', '_', name).strip('_') or 'judge'
    os.makedirs(os.path.join(dst, safe), exist_ok=True)
    shutil.copy(pr, os.path.join(dst, safe, 'F_PR.png'))
    sets[safe] = {
        'name': name,
        'width': values['JUDGEF_WIDTH'],
        'height': values['JUDGEF_HEIGHT'],
        'frames': int(values['DIVY_F_PR']),
        'cycle': values['JUDGE_ANIMATION_CYCLE_PR'],
        'scaleTime': values['JUDGE_SCALE_ANIMATION_TIME'],
        'scaleWidth': values['JUDGEF_SCALE_ANIMATION_WIDTH'],
        'scaleHeight': values['JUDGEF_SCALE_ANIMATION_HEIGHT'],
        'opacity': values['JUDGEF_SCALE_ANIMATION_OPACITY'],
    }

with open(os.path.join(dst, 'judges.json'), 'w', encoding='utf-8') as f:
    json.dump(sets, f, indent=2, ensure_ascii=False)
print(f'{len(sets)} judge sets -> {os.path.abspath(dst)}')
