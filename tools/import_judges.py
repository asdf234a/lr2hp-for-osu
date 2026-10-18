# Copies each judge set's POOR image (F_PR.png) and the judge.lua values the
# empty POOR overlay needs from a beatoraja simple-play skin.
#
#   python tools/import_judges.py "<beatoraja>/skin/<simple-play>/customize/judge" [out folder] [--only Iridium --as default]
#
# --only picks one judge set; --as gives it another folder name. Without them every set is copied.
# Sets already in the output folder's judges.json are kept, so it can be run once per set.
# The repo ships only the judge sets of the original simple-play (mnpy); add others with this.
import json, os, re, shutil, sys
from PIL import Image

if len(sys.argv) < 2:
    sys.exit(__doc__ or 'usage: import_judges.py <customize/judge folder> [output folder]')
args = [a for a in sys.argv[1:]]
def take(flag):
    if flag in args:
        i = args.index(flag)
        value = args[i + 1]
        del args[i:i + 2]
        return value
    return None
only = take('--only')
rename = take('--as')
src = args[0]
dst = args[1] if len(args) > 1 else os.path.join(os.path.dirname(__file__), '..', 'lr2hp-for-osu-emptypoor', 'skins', 'judge')

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

index = os.path.join(dst, 'judges.json')
try:
    with open(index, encoding='utf-8') as f:
        sets = json.load(f)
except (OSError, ValueError):
    sets = {}
added = 0
for name in sorted(os.listdir(src)):
    if only and name != only:
        continue
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
    safe = rename or re.sub(r'[^A-Za-z0-9_-]+', '_', name).strip('_') or 'judge'
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
    added += 1

os.makedirs(dst, exist_ok=True)
with open(index, 'w', encoding='utf-8') as f:
    json.dump(sets, f, indent=2, ensure_ascii=False)
print(f'{added} added, {len(sets)} judge sets in {os.path.abspath(dst)}')
