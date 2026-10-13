"""Assemble la vidéo tutoriel à partir de l'enregistrement (record.js) : images + voix + musique.
Usage : python build.py <dossier_enregistrement> <fichier_sortie.mp4>"""
import json, os, subprocess, sys

rec, out = sys.argv[1], sys.argv[2]
tl = json.load(open(os.path.join(rec, 'timeline.json')))
here = os.path.dirname(os.path.abspath(__file__))
duration = tl['duration']

# 1. Vidéo : chaque image dure jusqu'à la suivante (l'écran n'envoie une image que s'il change).
frames = tl['frames']
lines = ['ffconcat version 1.0']
for i, f in enumerate(frames):
    nxt = frames[i + 1]['t'] if i + 1 < len(frames) else duration
    lines += [f"file '{f['file']}'", f"duration {max(0.001, nxt - f['t']):.4f}"]
lines.append(f"file '{frames[-1]['file']}'")
open(os.path.join(rec, 'frames.ffconcat'), 'w').write('\n'.join(lines))

# 2. Son : musique très discrète + chaque voix à son instant exact.
music = os.path.join(rec, 'music.wav')
subprocess.run([sys.executable, os.path.join(here, '..', 'music.py'), music, f'{duration:.2f}'], check=True)
VOLUME = {'narration': 1.0, 'interp': 1.0, 'prof': 0.95, 'prof-ducked': 0.5}  # le prof baisse quand l'interprète parle
# Entrée 0 : les images ; entrée 1 : la musique ; puis une entrée par voix.
inputs, filters = ['-i', music], ['[0:v]fps=30,format=yuv420p[vout]', '[1:a]volume=0.07[m]']
for i, e in enumerate(tl['events'], start=1):
    inputs += ['-i', e['file']]
    ms = int(e['t'] * 1000)
    filters.append(f"[{i + 1}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume={VOLUME[e['kind']]},adelay={ms}|{ms}[a{i}]")
mix = '[m]' + ''.join(f'[a{i}]' for i in range(1, len(tl['events']) + 1))
filters.append(f"{mix}amix=inputs={len(tl['events']) + 1}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")

subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', os.path.join(rec, 'frames.ffconcat'), *inputs,
                '-filter_complex', ';'.join(filters), '-map', '[vout]', '-map', '[aout]',
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
                '-c:a', 'aac', '-b:a', '160k', '-t', f'{duration:.2f}', '-movflags', '+faststart', out], check=True)
print('Vidéo prête :', out)
