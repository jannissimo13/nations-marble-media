"""Rendert einen Stapel Flag-Duel-Shorts.
Aufruf: python3 batch.py PICKS.json MUSIK_ORDNER OUT_ORDNER [parallel]
Schreibt OUT_ORDNER/manifest.json mit Dateiname, Titel und Beschreibung je Short.
"""
import json, os, random, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
picks = json.load(open(sys.argv[1]))
music_dir, out_dir = sys.argv[2], sys.argv[3]
par = int(sys.argv[4]) if len(sys.argv) > 4 else 2
os.makedirs(out_dir, exist_ok=True)
tracks = sorted(f for f in os.listdir(music_dir) if f.lower().endswith('.mp3')) if music_dir and os.path.isdir(music_dir) else []

order = tracks[:]; random.Random(sum(p['seed'] for p in picks)).shuffle(order)  # verschiedene Tracks pro Stapel

def slug(s): return ''.join(ch.lower() if ch.isalnum() else '-' for ch in s).strip('-').replace('--', '-')

def make_title(a, b):
    # YouTube zeigt die ersten 3 Hashtags über dem Titel; Titel max. 100 Zeichen
    for tail in (' – Who wins? #shorts #flags #countries', ' – Who wins? #shorts #flags', ' #shorts #flags', ' #shorts'):
        t = f"{a} vs {b}{tail}"
        if len(t) <= 100: return t
    return f"{a} vs {b}"[:100]

def job(p):
    a, b = p['names']
    fname = f"flagduel-{p['seed']}-{slug(a)}-vs-{slug(b)}.mp4"
    music = os.path.join(music_dir, order[picks.index(p) % len(order)]) if tracks else '-'
    r = subprocess.run(['python3', os.path.join(HERE, 'render.py'), str(p['seed']), os.path.join(out_dir, fname), music, json.dumps(p['ids'])],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return {**p, 'file': fname, 'error': r.stderr[-800:]}
    res = json.loads(r.stdout.strip().splitlines()[-1])
    req = ' Requested in the comments!' if p.get('requested') else ''
    return {**p, 'file': fname, 'music': os.path.basename(music) if tracks else None, 'seconds': res['seconds'], 'winner': res['winner'],
            'title': make_title(a, b),
            'text': (f"{a} vs {b} in the arena!{req} Spikes hit, shields block – last country standing wins. "
                     f"Which duel should be next? Comment: COUNTRY vs COUNTRY\n\n"
                     f"#shorts #flags #countries #geography #worldflags #battle #simulation #satisfying #nationsmarble")}

with ThreadPoolExecutor(par) as ex:
    results = list(ex.map(job, picks))
json.dump(results, open(os.path.join(out_dir, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
for r in results:
    print(('FEHLER ' if 'error' in r else 'ok     ') + r['file'], r.get('seconds'), r.get('winner'), r.get('music'))
