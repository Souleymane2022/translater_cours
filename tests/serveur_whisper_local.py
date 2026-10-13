"""Serveur local compatible « /v1/audio/transcriptions » (API OpenAI) qui utilise Whisper via sherpa-onnx."""
import io, json, email.parser, email.policy, soundfile as sf, numpy as np, sherpa_onnx
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
d = os.environ.get('WHISPER_DIR', 'models/sherpa-onnx-whisper-small') + '/'
recs = {}
def rec(lang):
    if lang not in recs:
        recs[lang] = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=d + 'small-encoder.int8.onnx', decoder=d + 'small-decoder.int8.onnx', tokens=d + 'small-tokens.txt', language=lang, task='transcribe', num_threads=4)
    return recs[lang]
class H(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*'); self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        raw = self.rfile.read(int(self.headers['Content-Length']))
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(b'Content-Type: ' + self.headers['Content-Type'].encode() + b'\r\n\r\n' + raw)
        fields = {p.get_param('name', header='content-disposition'): p.get_payload(decode=True) for p in msg.iter_parts()}
        a, sr = sf.read(io.BytesIO(fields['file']), dtype='float32')
        lang = (fields.get('language') or b'en').decode()
        r = rec(lang); s = r.create_stream(); s.accept_waveform(sr, a); r.decode_stream(s)
        text = s.result.text.strip()
        print(f'[{lang}] {len(a)/sr:.1f}s → {text}', flush=True)
        body = json.dumps({'text': text}).encode()
        self.send_response(200); self.cors(); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', 8766), H).serve_forever()
