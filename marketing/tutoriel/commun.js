// Outils partagés par les scripts de tournage (record.js, record-ordinateur.js).
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

// Lit le manifeste de prepare.py ; ses chemins sont relatifs au dossier parent des clips.
function loadManifest(clipsDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(clipsDir, 'manifest.json'), 'utf8'));
  const abs = (f) => (path.isAbsolute(f) ? f : path.join(path.dirname(clipsDir), f));
  for (const n of Object.values(manifest.narration)) n.file = abs(n.file);
  for (const items of Object.values(manifest.lecture)) {
    for (const it of items) { it.prof = abs(it.prof); if (it.interp) it.interp = abs(it.interp); }
  }
  return manifest;
}

// WAV PCM float32 ou int16 mono 24 kHz (sortie de Kokoro) → Int16 little-endian.
function wavPcm16(file) {
  const buf = fs.readFileSync(file);
  let off = 12; let fmt; let data;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4); const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (fmt.bits === 16) return Buffer.from(data);
  const out = Buffer.alloc((data.length / 4) * 2);
  for (let i = 0; i < data.length / 4; i++) {
    const v = Math.max(-1, Math.min(1, data.readFloatLE(i * 4)));
    out.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }
  return out;
}

// Serveur Gemini Live simulé : renvoie, au rythme de la parole, le texte du professeur, la traduction
// (préparée par prepare.py) et la voix de l'interprète. `events` reçoit l'instant de chaque voix.
async function mockGeminiLive(context, events) {
  const state = { live: null, setups: [] };
  await context.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(raw);
      if (!msg.setup) return;
      state.live = ws;
      state.setups.push(msg.setup);
      ws.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  const send = (obj) => { try { if (state.live) state.live.send(JSON.stringify(obj)); } catch { /* connexion fermée */ } };

  async function stream(it, start, dur) {
    await sleep(Math.max(0, start - now()) * 1000);
    if (it.interp) events.push({ file: it.interp, t: now(), kind: 'interp' });
    const t0 = now();
    const enWords = it.en.split(' ');
    const trWords = it.tr.split(' ');
    const pcm = it.interp ? wavPcm16(it.interp) : null;
    const chunk = 24000 * 2 / 10; // 100 ms à 24 kHz
    let sentEn = 0; let sentTr = 0; let sentPcm = 0;
    for (;;) {
      const p = Math.min(1, (now() - t0) / dur);
      const nEn = Math.ceil(p * enWords.length); const nTr = Math.ceil(p * trWords.length);
      const sc = {};
      if (nEn > sentEn) { sc.inputTranscription = { text: `${enWords.slice(sentEn, nEn).join(' ')} ` }; sentEn = nEn; }
      if (nTr > sentTr) { sc.outputTranscription = { text: `${trWords.slice(sentTr, nTr).join(' ')} ` }; sentTr = nTr; }
      if (pcm && sentPcm < pcm.length) {
        const until = Math.min(pcm.length, Math.floor(((now() - t0) + 0.2) * 48000 / 2) * 2);
        if (until > sentPcm) {
          sc.modelTurn = { parts: [] };
          for (let o = sentPcm; o < until; o += chunk) {
            sc.modelTurn.parts.push({ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.subarray(o, Math.min(until, o + chunk)).toString('base64') } });
          }
          sentPcm = until;
        }
      }
      if (Object.keys(sc).length) send({ serverContent: sc });
      if (p >= 1) break;
      await sleep(80);
    }
    await sleep(150);
    send({ serverContent: { turnComplete: true } });
  }

  // Le professeur dit chaque phrase ; l'interprète suit avec ~1,3 s de décalage, sans se chevaucher.
  async function lecture(items, onSentence = () => {}) {
    let cursor = now();
    let interpEnd = 0;
    const jobs = [];
    for (const [i, it] of items.entries()) {
      const wait = cursor - now();
      if (wait > 0) await sleep(wait * 1000);
      const p = now();
      onSentence(i);
      events.push({ file: it.prof, t: p, kind: it.interp ? 'prof-ducked' : 'prof' });
      const start = Math.max(p + 1.3, interpEnd + 0.25);
      const dur = it.interp ? it.interp_dur : it.prof_dur * 0.9;
      interpEnd = start + dur;
      jobs.push(stream(it, start, dur));
      cursor = p + it.prof_dur + 0.5;
    }
    await Promise.all(jobs);
    await sleep(1200);
  }

  return { state, lecture };
}

// Enregistre la page (CDP screencast) ; stop() écrit timeline.json pour build.py.
async function startRecording(context, page, outDir, events) {
  fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = path.join(outDir, 'frames', `f${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  await sleep(300);
  return async function stop() {
    await cdp.send('Page.stopScreencast');
    await sleep(300);
    const t0 = frames[0].t;
    const duration = now() - t0;
    fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({
      duration,
      frames: frames.map((f) => ({ file: f.file, t: f.t - t0 })),
      events: events.map((e) => ({ ...e, t: e.t - t0 })),
    }, null, 1));
    console.log(`${frames.length} images, ${duration.toFixed(1)} s, ${events.length} voix`);
  };
}

module.exports = { sleep, now, loadManifest, wavPcm16, mockGeminiLive, startRecording };
