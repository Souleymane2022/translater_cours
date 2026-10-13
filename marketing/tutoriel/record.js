// Filme le tutoriel : pilote l'application réelle dans stage.html, enregistre l'écran (CDP screencast)
// et note l'instant de chaque voix pour assembler ensuite le son (voir build.sh).
//
// Gemini Live est remplacé par un serveur simulé qui renvoie, au rythme de la parole, le texte du
// professeur et sa traduction (vraie traduction Google préparée par prepare.py) ainsi que la voix
// de l'interprète. Tout le reste est l'application réelle.
//
// Usage : node record.js <dossier_clips> <dossier_sortie>   (le site doit être servi sur localhost:8765)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const clipsDir = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const manifest = JSON.parse(fs.readFileSync(path.join(clipsDir, 'manifest.json'), 'utf8'));
// Les chemins du manifeste sont relatifs au dossier d'où prepare.py a été lancé (parent des clips).
const abs = (f) => (path.isAbsolute(f) ? f : path.join(path.dirname(clipsDir), f));
for (const n of Object.values(manifest.narration)) n.file = abs(n.file);
for (const items of Object.values(manifest.lecture)) for (const it of items) { it.prof = abs(it.prof); if (it.interp) it.interp = abs(it.interp); }
const BASE = 'http://localhost:8765';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = []; // { file, t (s, horloge murale), kind }
const now = () => Date.now() / 1000;

function wavPcm16(file) {
  // WAV PCM float32 ou int16 mono 24 kHz (sortie de Kokoro) → Int16 little-endian.
  const buf = fs.readFileSync(file);
  let off = 12; let fmt; let data;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4); const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), bits: buf.readUInt16LE(off + 22) };
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

(async () => {
  fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, serviceWorkers: 'block' });

  // Réglages de départ de l'application (comme un nouvel utilisateur ayant déjà ouvert le site une fois).
  await context.addInitScript(() => {
    if (location.pathname === '/' && !sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('traducteur-cours-settings', JSON.stringify({
        version: 2, source: 'mic', engine: 'browser', srcLang: 'en-US', tgtLang: 'en', translator: 'auto',
        speak: false, showOriginal: true, fontSize: '30', geminiKey: '',
      }));
    }
    // Micro : flux silencieux (la parole est simulée côté serveur Gemini).
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  });

  // Serveur Gemini Live simulé.
  let live = null;
  await context.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(raw);
      if (msg.setup) { live = { ws, setup: msg.setup }; ws.send(JSON.stringify({ setupComplete: {} })); }
    });
  });

  const page = await context.newPage();
  await page.goto(`${BASE}/marketing/tutoriel/stage.html`);
  await page.evaluate(() => document.fonts.ready);
  const stage = (fn, ...args) => page.evaluate(([fn, args]) => window.stage[fn](...args), [fn, args]);

  // Enregistrement de l'écran.
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

  const narrate = async (key, { wait = true, extra = 0.25 } = {}) => {
    const n = manifest.narration[key];
    events.push({ file: n.file, t: now(), kind: 'narration' });
    await stage('sub', n.text);
    if (wait) await sleep((n.dur + extra) * 1000);
    return n.dur;
  };

  let app = null;
  const appFrame = async () => {
    for (let i = 0; i < 50 && !app; i++) { app = page.frames().find((f) => f.url().startsWith(`${BASE}/`) && !f.url().includes('marketing')); await sleep(100); }
    return app;
  };
  const tap = async (selector) => {
    const rect = await app.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await stage('tap', rect);
    await sleep(380);
  };
  const scrollTo = async (selector, block = 'center') => {
    await app.$eval(selector, (el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block);
    await sleep(700);
  };

  // Parole du professeur + traduction en direct.
  const send = (obj) => { try { if (live) live.ws.send(JSON.stringify(obj)); } catch { /* connexion fermée */ } };
  async function lecture(lang) {
    // Le démarrage de l'application modifie la mise en page : on recadre sur la zone de traduction.
    await app.$eval('#stage', (el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    await sleep(500);
    const items = manifest.lecture[lang];
    let cursor = now();
    let interpEnd = 0;
    const jobs = [];
    for (const it of items) {
      const wait = cursor - now();
      if (wait > 0) await sleep(wait * 1000);
      const p = now();
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
  async function stream(it, start, dur) {
    await sleep(Math.max(0, start - now()) * 1000);
    if (it.interp) events.push({ file: it.interp, t: now(), kind: 'interp' });
    const t0 = now();
    const enWords = it.en.split(' ');
    const trWords = it.tr.split(' ');
    const pcm = it.interp ? wavPcm16(it.interp) : null;
    const chunk = 24000 * 2 / 10; // 100 ms à 24 kHz
    let sentEn = 0; let sentTr = 0; let sentPcm = 0;
    while (true) {
      const p = Math.min(1, (now() - t0) / dur);
      const nEn = Math.ceil(p * enWords.length); const nTr = Math.ceil(p * trWords.length);
      const sc = {};
      if (nEn > sentEn) { sc.inputTranscription = { text: enWords.slice(sentEn, nEn).join(' ') + ' ' }; sentEn = nEn; }
      if (nTr > sentTr) { sc.outputTranscription = { text: trWords.slice(sentTr, nTr).join(' ') + ' ' }; sentTr = nTr; }
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

  // ---------------- Scénario ----------------
  await narrate('n1', { extra: 0.4 });

  await stage('card', 'intro', false);
  await stage('step', '1', 'Ouvre le site');
  const n2 = narrate('n2');
  await sleep(500);
  const url = 'souleymane2022.github.io/translater_cours';
  for (let i = 1; i <= url.length; i += 2) { await stage('url', url.slice(0, i)); await sleep(45); }
  await stage('url', url, false);
  await stage('load', `${BASE}/`);
  await appFrame();
  await app.waitForSelector('#startBtn');
  // Pour le tournage : espace sous la page, afin de pouvoir cadrer la zone de traduction en haut de l'écran.
  await app.addStyleTag({ content: 'main { padding-bottom: 700px; }' });
  await sleep(400);
  await stage('reveal');
  await n2;

  await stage('step', '2', 'Choisis « Gemini Live » et ta clé');
  const n3 = narrate('n3');
  await sleep(300);
  await tap('#engine');
  await app.selectOption('#engine', 'live');
  await app.dispatchEvent('#engine', 'change');
  await sleep(600);
  await scrollTo('#geminiKey');
  await tap('#geminiKey');
  await app.type('#geminiKey', 'AIzaSyDemo-Cle-Gratuite-123', { delay: 45 });
  await n3;

  await stage('step', '3', 'Choisis ta langue');
  const n4 = narrate('n4');
  await scrollTo('#tgtLang');
  await tap('#tgtLang');
  await app.selectOption('#tgtLang', 'fr');
  await sleep(900);
  await scrollTo('#speak');
  await tap('#speak');
  await app.check('#speak');
  await n4;

  await stage('step', '4', 'Appuie sur Démarrer');
  const n5 = narrate('n5');
  await scrollTo('#startBtn');
  await tap('#startBtn');
  await app.click('#startBtn');
  await sleep(500);
  await scrollTo('#stage', 'start');
  await n5;

  await stage('step', '🎧', 'Anglais → Français, en direct');
  await stage('sub', 'Tu entends le prof 🇬🇧 <em>et</em> l’interprète 🇫🇷');
  await lecture('fr');

  await stage('step', '5', 'Et dans d’autres langues');
  const n6 = narrate('n6');
  await scrollTo('#stopBtn');
  await tap('#stopBtn');
  await app.click('#stopBtn');
  await sleep(300);
  await scrollTo('#tgtLang');
  await tap('#tgtLang');
  await app.selectOption('#tgtLang', 'es');
  await sleep(500);
  await scrollTo('#startBtn');
  await tap('#startBtn');
  await app.click('#startBtn');
  await sleep(400);
  await scrollTo('#stage', 'start');
  await n6;
  await stage('step', '🎧', 'Anglais → Espagnol');
  await stage('sub', 'Tu entends le prof 🇬🇧 <em>et</em> l’interprète 🇪🇸');
  await lecture('es');

  await stage('step', '🌍', 'Anglais → Arabe');
  const n7 = narrate('n7');
  await scrollTo('#stopBtn');
  await tap('#stopBtn');
  await app.click('#stopBtn');
  await scrollTo('#tgtLang');
  await tap('#tgtLang');
  await app.selectOption('#tgtLang', 'ar');
  await sleep(300);
  await scrollTo('#startBtn');
  await tap('#startBtn');
  await app.click('#startBtn');
  await sleep(300);
  await scrollTo('#stage', 'start');
  await n7;
  await stage('sub', 'Le texte arabe s’affiche de droite à gauche 🇸🇦');
  await lecture('ar');

  await stage('card', 'cta', true);
  await stage('sub', '');
  await sleep(400);
  await narrate('n8', { extra: 1.4 });

  await cdp.send('Page.stopScreencast');
  await sleep(300);
  const setups = live ? [live.setup.generationConfig.translationConfig] : [];
  await browser.close();

  // Chronologie : tout est exprimé en secondes depuis la première image.
  const t0 = frames[0].t;
  const end = now() - t0;
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({
    duration: end,
    frames: frames.map((f) => ({ file: f.file, t: f.t - t0 })),
    events: events.map((e) => ({ ...e, t: e.t - t0 })),
    lastSetup: setups,
  }, null, 1));
  console.log(`${frames.length} images, ${end.toFixed(1)} s, ${events.length} voix`);
})();
