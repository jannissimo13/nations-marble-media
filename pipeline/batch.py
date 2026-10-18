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

def country_tag(name):
    # Hashtag aus dem Ländernamen: "South Korea" -> #southkorea, "USA" -> #usa
    return '#' + ''.join(ch for ch in name.lower() if ch.isalnum())

MODE_TEXT = {
    'classic': 'in the arena',
    'pinball': 'in the PINBALL arena – bumpers everywhere',
    'shrink': 'in the SHRINKING arena – the walls are closing in',
    'spinner': 'in the SPINNER arena – dodge the deadly bar',
    'web': 'CONNECTIONS – five countries, one web of links',
    'storm': 'in the SPIKE STORM – double the spikes',
}

def make_title(a, b, *more):
    if more:
        names = [a, b, *more]
        for tail in (' – Who wins? #shorts #flags #countries', ' #shorts #flags', ' #shorts'):
            t = ' vs '.join(names) + tail
            if len(t) <= 100: return t
        return f"{len(names)} Countries, 1 Winner – CONNECTIONS #shorts #flags #countries"
    # YouTube zeigt die ersten 3 Hashtags über dem Titel; Titel max. 100 Zeichen
    for tail in (' – Who wins? #shorts #flags #countries', ' – Who wins? #shorts #flags', ' #shorts #flags', ' #shorts'):
        t = f"{a} vs {b}{tail}"
        if len(t) <= 100: return t
    return f"{a} vs {b}"[:100]

def job(p):
    a, b = p['names'][:2]
    web = p.get('mode') == 'web'
    fname = f"flagduel-{p['seed']}-{'-vs-'.join(slug(n) for n in p['names'])}.mp4"
    music = os.path.join(music_dir, order[picks.index(p) % len(order)]) if tracks else '-'
    r = subprocess.run(['python3', os.path.join(HERE, 'render.py'), str(p['seed']), os.path.join(out_dir, fname), music, json.dumps(p['ids']), p.get('mode') or 'classic'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return {**p, 'file': fname, 'error': r.stderr[-800:]}
    res = json.loads(r.stdout.strip().splitlines()[-1])
    req = ' Requested in the comments!' if p.get('requested') else ''
    return {**p, 'file': fname, 'music': os.path.basename(music) if tracks else None, 'seconds': res['seconds'], 'winner': res['winner'],
            'title': make_title(*p['names']) if web else make_title(a, b),
            'mode': p.get('mode') or 'classic',
            'text': (f"{' vs '.join(p['names']) if web else a + ' vs ' + b} {MODE_TEXT.get(p.get('mode') or 'classic', 'in the arena')}!{req} {'Cut the links, keep yours – last country standing wins. ' if web else 'Spikes hit, shields block – last country standing wins. '}"
                     f"Which duel should be next? Comment: COUNTRY vs COUNTRY\n\n"
                     f"#shorts #flags #countries #geography #worldflags #battle #simulation #satisfying #nationsmarble "
                     f"{' '.join(country_tag(n) for n in p['names'])}")}

with ThreadPoolExecutor(par) as ex:
    results = list(ex.map(job, picks))
json.dump(results, open(os.path.join(out_dir, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
for r in results:
    print(('FEHLER ' if 'error' in r else 'ok     ') + r['file'], r.get('seconds'), r.get('winner'), r.get('music'))
