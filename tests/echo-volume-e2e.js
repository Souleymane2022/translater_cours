// Tests « vidéo en pause » et « baisser le son d'origine » sur l'application réelle (Gemini Live simulé) :
//  1. mode haut-parleur : l'écho d'une traduction déjà dite est jeté (texte et voix), les vraies phrases passent ;
//  2. mode haut-parleur : pendant que l'interprète parle, le micro n'envoie que du silence ;
//  3. silence prolongé (vidéo en pause) : plus rien n'est envoyé à Gemini ;
//  4. fichier : le son d'origine baisse pendant la voix, puis remonte ;
//  5. onglet partagé (ordinateur) : l'onglet est rendu muet, l'application rejoue son son et le baisse pendant la voix.
// Usage : node echo-volume-e2e.js <fichier_audio.wav>   (site servi sur http://localhost:8765)
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8765/';
const wav = path.resolve(process.argv[2]);
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VOICE = Buffer.alloc(24000 * 2 * 2).toString('base64'); // 2 s de voix (24 kHz, 16 bits)

async function context(browser, { tone = true } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript((tone) => {
    window.__played = 0; window.__ramps = []; window.__gdm = null;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { window.__played++; return start.apply(this, a); };
    const ramp = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (v, ...a) { window.__ramps.push(Math.round(v * 100) / 100); return ramp.call(this, v, ...a); };
    const fakeStream = () => {
      const ac = new AudioContext(); const d = ac.createMediaStreamDestination();
      if (tone) { const o = ac.createOscillator(); const g = ac.createGain(); g.gain.value = 0.2; o.connect(g).connect(d); o.start(); }
      return d.stream;
    };
    navigator.mediaDevices.getUserMedia = async () => fakeStream();
    navigator.mediaDevices.getDisplayMedia = async (c) => {
      window.__gdm = c; const s = fakeStream(); const t = s.getAudioTracks()[0];
      t.getSettings = () => ({ suppressLocalAudioPlayback: !!c.audio.suppressLocalAudioPlayback });
      return s;
    };
  }, tone);
  const state = { ws: null, frames: [] };
  await ctx.routeWebSocket(/generativelanguage/, (ws) => ws.onMessage((raw) => {
    const m = JSON.parse(raw);
    if (m.setup) { state.ws = ws; ws.send(JSON.stringify({ setupComplete: {} })); }
    if (m.realtimeInput) {
      const pcm = Buffer.from(m.realtimeInput.audio.data, 'base64');
      let max = 0; for (let i = 0; i < pcm.length; i += 2) max = Math.max(max, Math.abs(pcm.readInt16LE(i)));
      state.frames.push({ t: Date.now(), max });
    }
  }));
  const turn = (fr, { audio = true } = {}) => {
    const words = fr.split(' ');
    for (let i = 0; i < words.length; i += 2) {
      const sc = { outputTranscription: { text: `${words.slice(i, i + 2).join(' ')} ` }, inputTranscription: { text: 'x ' } };
      if (audio && i === 0) sc.modelTurn = { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: VOICE } }] };
      state.ws.send(JSON.stringify({ serverContent: sc }));
    }
    state.ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
  };
  return { ctx, state, turn };
}
async function startLive(p, source) {
  await p.goto(BASE);
  await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k'); await p.check('#speak');
  await p.selectOption('#source', source);
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  // 1 + 2. Haut-parleur : écho jeté, semi-duplex
  {
    const { ctx, state, turn } = await context(browser);
    const p = await ctx.newPage();
    await startLive(p, 'speaker');
    await p.click('#startBtn'); await sleep(1500);
    const A = 'Bonjour à tous, aujourd\'hui nous allons parler de la photosynthèse.';
    turn(A); await sleep(300);
    const playedAfterA = await p.evaluate(() => window.__played);
    const tVoice = Date.now();
    await sleep(1500);
    const during = state.frames.filter((f) => f.t > tVoice + 300 && f.t < tVoice + 1500);
    ok(during.length === 0 || during.every((f) => f.max === 0), 'Haut-parleur : pendant la voix de l\'interprète, le micro n\'envoie que du silence');
    await sleep(2500);
    const after = state.frames.filter((f) => f.t > tVoice + 2600);
    ok(after.some((f) => f.max > 0), 'Haut-parleur : l\'écoute reprend quand la voix s\'arrête');
    turn(A); await sleep(400);                                                    // écho exact
    turn('Aujourd\'hui nous allons parler de la photosynthèse'); await sleep(400);  // écho partiel
    const playedAfterEchoes = await p.evaluate(() => window.__played);
    turn('Aujourd\'hui nous allons voir la chimie organique en détail.'); await sleep(400); // vraie phrase
    const hist = await p.$$eval('#history .tr', (e) => e.map((x) => x.textContent));
    console.log('   historique :', hist.join(' | '));
    ok(hist.length === 2 && /chimie/.test(hist[1]), 'Écho : les répétitions sont jetées, la nouvelle phrase (même début) passe');
    ok(playedAfterEchoes === playedAfterA, 'Écho : la voix des répétitions n\'est pas jouée');
    ok(await p.evaluate(() => window.__played) > playedAfterEchoes, 'Écho : la voix de la nouvelle phrase est jouée');
    await ctx.close();
  }

  // 3. Silence prolongé
  {
    const { ctx, state } = await context(browser, { tone: false });
    const p = await ctx.newPage();
    await startLive(p, 'mic');
    await p.click('#startBtn'); await sleep(5500);
    console.log(`   images envoyées en 5 s de silence : ${state.frames.length}`);
    ok(state.frames.length > 0 && state.frames.length <= 20, 'Pause : après 1,5 s de silence, plus rien n\'est envoyé à Gemini');
    await ctx.close();
  }

  // 4. Fichier : baisse du son d'origine
  {
    const { ctx, turn } = await context(browser);
    const p = await ctx.newPage();
    await startLive(p, 'file');
    await p.setInputFiles('#fileInput', wav);
    await p.click('#startBtn'); await sleep(1200);
    turn('Bonjour à tous, bienvenue au cours.'); await sleep(3000);
    const ramps = await p.evaluate(() => window.__ramps);
    console.log('   volumes appliqués :', ramps.join(' → '));
    ok(ramps.includes(0.2) && ramps.lastIndexOf(1) > ramps.indexOf(0.2), 'Fichier : le son baisse pendant la voix puis remonte');
    await ctx.close();
  }

  // 5. Onglet partagé
  {
    const { ctx, turn } = await context(browser);
    const p = await ctx.newPage();
    await startLive(p, 'tab');
    await p.click('#startBtn'); await sleep(1200);
    ok(await p.evaluate(() => window.__gdm && window.__gdm.audio.suppressLocalAudioPlayback === true), 'Onglet : l\'onglet partagé est rendu muet par le navigateur');
    turn('Bonjour à tous, bienvenue au cours.'); await sleep(3000);
    const ramps = await p.evaluate(() => window.__ramps);
    ok(ramps.includes(0.2) && ramps.lastIndexOf(1) > ramps.indexOf(0.2), 'Onglet : l\'application rejoue son son, baissé pendant la voix');
    await ctx.close();
  }
  await browser.close();
})();
