// Reproduit le comportement réel de Gemini Live observé sur un téléphone (vidéo YouTube dans l'application) :
// Gemini envoie de l'audio en continu, y compris des morceaux de silence, et ne termine jamais ses tours.
// Avant correction, l'application croyait que l'interprète parlait sans fin : micro coupé, volume YouTube
// bloqué à 20 %, traduction figée, historique vide.
//  1. le volume YouTube remonte et le micro se rouvre dès que la voix audible s'arrête ;
//  2. l'historique se remplit phrase par phrase sans fin de tour, et la phrase en cours y part après 2,5 s ;
//  3. une voix audible ininterrompue ne coupe jamais le micro plus de 8 s.
// Usage : node gemini-reel-e2e.js   (site servi sur http://localhost:8765)
const { chromium } = require('playwright');

const BASE = 'http://localhost:8765/';
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pcm = (ms, audible) => {
  const n = Math.round(24 * ms); const b = Buffer.alloc(n * 2);
  if (audible) for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2);
  return b.toString('base64');
};
const SILENCE = pcm(100, false); const VOICE = pcm(100, true);
const FAKE_YT = `window.YT = { Player: class {
  constructor(el, opts) { this.opts = opts; this.state = 5; window.__ytp = this; window.__vols = [];
    setTimeout(() => opts.events.onReady({ target: this }), 50); }
  playVideo() { this.state = 1; this.opts.events.onStateChange({ data: 1 }); }
  pauseVideo() { this.state = 2; this.opts.events.onStateChange({ data: 2 }); }
  getPlayerState() { return this.state; } setVolume(v) { window.__vols.push(v); } cueVideoById() {}
} }; setTimeout(() => window.onYouTubeIframeAPIReady(), 10);`;

async function run(browser, script) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain();
      g.gain.value = 0.2; o.connect(g); const d = ac.createMediaStreamDestination(); g.connect(d); o.start();
      return d.stream;
    };
  });
  await ctx.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE_YT }));
  const st = { ws: null, frames: [] };
  await ctx.routeWebSocket(/generativelanguage/, (ws) => ws.onMessage((raw) => {
    const m = JSON.parse(raw);
    if (m.setup) { st.ws = ws; ws.send(JSON.stringify({ setupComplete: {} })); }
    if (m.realtimeInput && m.realtimeInput.audio) {
      const b = Buffer.from(m.realtimeInput.audio.data, 'base64'); let max = 0;
      for (let i = 0; i < b.length; i += 2) max = Math.max(max, Math.abs(b.readInt16LE(i)));
      st.frames.push({ t: Date.now(), max });
    }
  }));
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k'); await p.check('#speak'); await p.check('#duck');
  await p.uncheck('#autoPause');
  await p.selectOption('#source', 'youtube');
  await p.fill('#ytUrl', 'https://youtu.be/6erL5SW3vZc'); await p.click('#ytLoad'); await sleep(300);
  await p.click('#startBtn'); await sleep(1000);
  // Audio en continu toutes les 100 ms, comme le vrai Gemini.
  let voiceUntil = 0;
  const stream = setInterval(() => {
    const data = Date.now() < voiceUntil ? VOICE : SILENCE;
    try { st.ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data } }] } } })); } catch { /* fermé */ }
  }, 100);
  const say = (fr, en) => st.ws.send(JSON.stringify({ serverContent: { outputTranscription: { text: fr }, inputTranscription: { text: en } } }));
  await script({ p, st, say, voice: (ms) => { voiceUntil = Date.now() + ms; } });
  clearInterval(stream);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  await run(browser, async ({ p, st, say, voice }) => {
    say('Je ne suis vraiment pas un expert en intelligence artificielle. ', 'I am definitely not an expert on AI. ');
    voice(2000);
    await sleep(300);
    say('Mais je suis très fier de la tradition suisse ', 'But I am very proud of the Swiss tradition ');
    await sleep(3200); // la voix audible est finie depuis ~1 s ; seul du silence arrive encore
    const vols = await p.evaluate(() => window.__vols);
    console.log('   volumes YouTube :', vols.join(' → '));
    ok(vols.includes(20) && vols[vols.length - 1] === 100, 'Volume : YouTube revient à 100 % quand la voix audible s\'arrête, malgré le silence envoyé en continu');
    const t = Date.now();
    await sleep(1000);
    ok(st.frames.filter((f) => f.t > t).some((f) => f.max > 0), 'Micro : il se rouvre après la voix, la traduction peut continuer');
    let hist = await p.$$eval('#history .tr', (e) => e.map((x) => x.textContent));
    ok(hist.length >= 1 && /expert en intelligence artificielle\.$/.test(hist[0]), 'Historique : la première phrase y est, sans attendre une fin de tour');
    await sleep(2000);
    hist = await p.$$eval('#history .tr', (e) => e.map((x) => x.textContent));
    console.log('   historique :', hist.join(' | '));
    ok(hist.length === 2 && /tradition suisse$/.test(hist[1]), 'Historique : la phrase en cours y part après 2,5 s sans nouveau texte');
  });

  await run(browser, async ({ st, voice }) => {
    voice(14000); // voix audible ininterrompue pendant 14 s
    await sleep(9500);
    const t = Date.now();
    await sleep(1500);
    ok(st.frames.filter((f) => f.t > t).some((f) => f.max > 0), 'Sécurité : même si la voix ne s\'arrête pas, le micro n\'est jamais coupé plus de 8 s');
  });
  await browser.close();
})();
