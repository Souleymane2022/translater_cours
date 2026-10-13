"""Prépare la vidéo tutoriel : vraies traductions (Google), voix (Kokoro), vérification par Whisper.
Usage : python prepare.py <dossier_modeles> <dossier_sortie>"""
import json, os, sys, urllib.parse, urllib.request
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

models, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
script = json.load(open(os.path.join(os.path.dirname(__file__), 'script.json')))
k = Kokoro(f'{models}/kokoro-v1.0.onnx', f'{models}/voices-v1.0.bin')

def translate(text, tgt):
    url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=en&tl=' + tgt + '&q=' + urllib.parse.quote(text)
    return ''.join(seg[0] for seg in json.load(urllib.request.urlopen(url, timeout=20))[0])

def voice(spec):
    name, lang, speed = spec
    if '+' in name:
        a, rest = name.split('+'); b, r = rest.split(':'); r = float(r)
        name = k.get_voice_style(a) * (1 - r) + k.get_voice_style(b) * r
    return name, lang, speed

def tts(text, spec, path):
    v, lang, speed = voice(spec)
    samples, sr = k.create(text, voice=v, speed=speed, lang=lang)
    sf.write(path, samples, sr)
    return round(len(samples) / sr, 2)

manifest = {'narration': {}, 'lecture': {}}
for key, text in script['narration'].items():
    # Une entrée peut être [texte affiché, texte prononcé] pour corriger la prononciation.
    shown, said = text if isinstance(text, list) else (text, text)
    path = f'{out}/{key}.wav'
    manifest['narration'][key] = {'text': shown, 'file': path, 'dur': tts(said, script['voices']['narrator'], path)}
for lang, sentences in script['lecture'].items():
    items = []
    for i, en in enumerate(sentences):
        tr = translate(en, lang)
        p_en = f'{out}/prof_{lang}{i}.wav'
        item = {'en': en, 'tr': tr, 'prof': p_en, 'prof_dur': tts(en, script['voices']['professor'], p_en)}
        if lang in script['voices']:
            p_tr = f'{out}/interp_{lang}{i}.wav'
            item.update(interp=p_tr, interp_dur=tts(tr, script['voices'][lang], p_tr))
        items.append(item)
    manifest['lecture'][lang] = items
json.dump(manifest, open(f'{out}/manifest.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(manifest, ensure_ascii=False, indent=1))
