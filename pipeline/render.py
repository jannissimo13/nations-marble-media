"""Rendert ein Flag-Duel als 1080x1920-MP4 mit Sound-Effekten und Musik.
Aufruf: python3 render.py SEED OUT.mp4 [MUSIK.mp3]
"""
import asyncio, base64, json, subprocess, sys, wave
import numpy as np
from playwright.async_api import async_playwright

SEED = int(sys.argv[1]); OUT = sys.argv[2]; MUSIC = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] not in ('', '-') else None
IDS = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None  # z. B. [36, 44]
FPS, SR = 30, 48000
import tempfile
_TD = tempfile.mkdtemp(prefix='duel_')
TMPV = f'{_TD}/v.mp4'; TMPA = f'{_TD}/sfx.wav'


async def render_video():
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
                           '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS), TMPV], stdin=subprocess.PIPE)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1080, 'height': 1920})
        import os
        page = 'file://' + os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flag-duel.html') + '?render=1'
        await pg.goto(page)
        await pg.evaluate(f'window.__init({SEED}, {json.dumps(IDS)})')
        n = 0
        while True:
            url = await pg.evaluate('window.__frame(0.93)')
            ff.stdin.write(base64.b64decode(url.split(',', 1)[1])); n += 1
            if n % 30 == 0:
                done = await pg.evaluate('window.__state().done')
                if done: break
            if n > FPS * 200: break
        st = await pg.evaluate('window.__state()')
        await b.close()
    ff.stdin.close(); ff.wait()
    return n, st


# ---------- Klangsynthese ----------
rng = np.random.default_rng(SEED)
def env(n, a=0.002, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)
def noise(n): return rng.uniform(-1, 1, n)
def lowpass(x, k):
    k = max(1, int(k)); return np.convolve(x, np.ones(k) / k, mode='same')
def sine(f, n, f2=None):
    t = np.arange(n) / SR
    if f2 is None: return np.sin(2 * np.pi * f * t)
    ph = 2 * np.pi * (f * t + (f2 - f) * t * t / (2 * t[-1]))
    return np.sin(ph)

def s_wall():
    n = int(0.06 * SR); return 0.18 * lowpass(noise(n), 6) * env(n, 0.001, 0.012) + 0.12 * sine(900, n) * env(n, 0.001, 0.01)
def s_bump():
    n = int(0.18 * SR); return 0.5 * sine(140, n, 70) * env(n, 0.002, 0.06) + 0.2 * lowpass(noise(n), 20) * env(n, 0.001, 0.02)
def s_pick_spike():
    n = int(0.45 * SR); x = sine(500, n, 1500) * env(n, 0.005, 0.12) * 0.35
    return x + 0.25 * sine(2400, n) * env(n, 0.002, 0.15) + 0.15 * (lowpass(noise(n), 2) * env(n, 0.001, 0.05))
def s_pick_shield():
    n = int(0.7 * SR); x = sum(sine(f, n) * env(n, 0.004, 0.35) for f in (660, 990, 1320)) * 0.16
    return x
def s_hit():
    n = int(0.55 * SR)
    return (0.9 * sine(110, n, 40) * env(n, 0.002, 0.16) + 0.55 * lowpass(noise(n), 8) * env(n, 0.001, 0.07)
            + 0.25 * sine(1800, n, 600) * env(n, 0.001, 0.05))
def s_block():
    n = int(0.6 * SR)
    x = 0.4 * (noise(n) - lowpass(noise(n), 4)) * env(n, 0.001, 0.12)
    return x + sum(sine(f, n) * env(n, 0.002, 0.25) for f in (1870, 2490, 3320)) * 0.08
def s_go():
    n = int(0.9 * SR)
    whoosh = lowpass(noise(n), 30) * np.sin(np.linspace(0, np.pi, n)) ** 2 * 0.35
    return whoosh + 0.8 * sine(90, n, 45) * env(n, 0.003, 0.2)
def s_overtime():
    n = int(1.2 * SR); return 0.25 * sine(200, n, 1200) * np.linspace(0, 1, n) ** 2 * env(n, 0.5, 0.5)
def s_ko():
    n = int(1.4 * SR)
    return 1.0 * sine(80, n, 30) * env(n, 0.003, 0.45) + 0.7 * lowpass(noise(n), 12) * env(n, 0.002, 0.25)
def s_fanfare():
    out = np.zeros(int(2.0 * SR))
    for k, (f, st) in enumerate([(523.3, 0), (659.3, 0.14), (784.0, 0.28), (1046.5, 0.42)]):
        n = int((1.5 if k == 3 else 0.35) * SR); i = int(st * SR)
        tone = (sine(f, n) + 0.4 * sine(2 * f, n) + 0.2 * sine(3 * f, n)) * env(n, 0.01, 0.6 if k == 3 else 0.2)
        out[i:i + n] += 0.22 * tone
    return out

SFX = {'wall': s_wall(), 'bump': s_bump(), 'pick_spike': s_pick_spike(), 'pick_shield': s_pick_shield(), 'hit': s_hit(),
       'block': s_block(), 'go': s_go(), 'overtime': s_overtime(), 'ko': s_ko(), 'fanfare': s_fanfare()}


def mix_sfx(events, total):
    buf = np.zeros(int(total * SR) + SR * 3)
    def put(name, t, g=1.0):
        s = SFX[name]; i = int(t * SR); buf[i:i + len(s)] += g * s
    last_wall = -1
    for e in events:
        k = e['type']
        if k == 'wall':
            if e['t'] - last_wall > 0.05: put('wall', e['t'], 0.8); last_wall = e['t']
        elif k == 'pickup': put('pick_spike' if e['item'] == 'spike' else 'pick_shield', e['t'])
        elif k in ('bump', 'hit', 'block', 'go', 'overtime'): put(k, e['t'])
        elif k == 'ko': put('ko', e['t']); put('fanfare', e['t'] + 0.95, 1.0)
    buf = buf[:int(total * SR)]
    buf = np.tanh(buf * 1.2) / 1.2
    st = np.stack([buf, buf], 1)
    with wave.open(TMPA, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(st, -1, 1) * 32000).astype('<i2').tobytes())


async def main():
    n, st = await render_video()
    total = n / FPS
    mix_sfx(st['events'], total)
    inputs = ['-i', TMPV, '-i', TMPA]
    if MUSIC:
        inputs += ['-stream_loop', '-1', '-i', MUSIC]
        fade_out = max(0, total - 2.5)
        filt = (f'[2:a]atrim=0:{total},volume=0.32,afade=t=in:d=1.2,afade=t=out:st={fade_out}:d=2.5,aformat=sample_rates={SR}:channel_layouts=stereo[m];'
                f'[1:a]volume=1.0[s];[s][m]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]')
    else:
        filt = '[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', filt, '-map', '0:v', '-map', '[a]',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', str(SR), '-shortest', '-movflags', '+faststart', OUT], check=True)
    print(json.dumps({'frames': n, 'seconds': round(total, 1), 'names': st['names'], 'winner': st['names'][st['winner']], 'lives': st['lives']}))

asyncio.run(main())
