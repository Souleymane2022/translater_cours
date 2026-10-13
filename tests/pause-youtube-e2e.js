// Tests « pause », « résistance » et « vidéo YouTube dans l'application » (Gemini Live et YouTube simulés) :
//  1. fichier mis en pause : Gemini est prévenu (audioStreamEnd), la traduction reprend avec la lecture ;
//  2. coupure passagère (quota par minute, erreur serveur) : reconnexion automatique, l'écoute continue ;
//     clé refusée : arrêt avec un message clair ;
//  3. message inattendu du serveur : aucun plantage ;
//  4. YouTube dans l'application : volume baissé pendant la voix puis remonté, pause suivie,
//     pause automatique pendant la voix si l'option est cochée.
// Usage : node pause-youtube-e2e.js <fichier_audio.wav>   (site servi sur http://localhost:8765)
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:8765/';
const wav = path.resolve(process.argv[2]);
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VOICE = Buffer.alloc(24000 * 2 * 2).toString('base64'); // 2 s de voix

const FAKE_YT = `window.YT = { Player: class {
  constructor(el, opts) { this.opts = opts; this.state = 5; window.__ytp = this; window.__vols = [];
    setTimeout(() => opts.events.onReady({ target: this }), 50); }
  playVideo() { this.state = 1; this.opts.events.onStateChange({ data: 1 }); }
  pauseVideo() { this.state = 2; this.opts.events.onStateChange({ data: 2 }); }
  getPlayerState() { return this.state; }
  setVolume(v) { window.__vols.push(v); }
  cueVideoById() {}
} }; setTimeout(() => window.onYouTubeIframeAPIReady(), 10);`;

async function context(browser, onSetup = (ws) => ws.send(JSON.stringify({ setupComplete: {} }))) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain();
      g.gain.value = 0.2; o.connect(g); const d = ac.createMediaStreamDestination(); g.connect(d); o.start();
      return d.stream;
    };
  });
  await ctx.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE_YT }));
  const state = { ws: null, setups: 0, ends: 0, frames: 0 };
  await ctx.routeWebSocket(/generativelanguage/, (ws) => ws.onMessage((raw) => {
    const m = JSON.parse(raw);
    if (m.setup) { state.ws = ws; state.setups++; onSetup(ws, state.setups); }
    if (m.realtimeInput && m.realtimeInput.audioStreamEnd) state.ends++;
    if (m.realtimeInput && m.realtimeInput.audio) state.frames++;
  }));
  const turn = (fr, audio = true) => {
    const sc = { outputTranscription: { text: fr }, inputTranscription: { text: 'x' } };
    if (audio) sc.modelTurn = { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: VOICE } }] };
    state.ws.send(JSON.stringify({ serverContent: sc }));
    state.ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
  };
  return { ctx, state, turn };
}
const live = async (p, source, speak = false) => {
  await p.goto(BASE);
  await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k');
  if (speak) await p.check('#speak'); else await p.uncheck('#speak');
  await p.selectOption('#source', source);
};
const status = (p) => p.textContent('#status');
const history = (p) => p.$$eval('#history .tr', (e) => e.map((x) => x.textContent));

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  // 1. Fichier : pause puis reprise
  {
    const { ctx, state, turn } = await context(browser);
    const p = await ctx.newPage();
    await live(p, 'file');
    await p.setInputFiles('#fileInput', wav);
    await p.click('#startBtn'); await sleep(1500);
    turn('Bonjour à tous.'); await sleep(300);
    await p.evaluate(() => document.getElementById('player').pause()); await sleep(800);
    ok(/En pause/.test(await status(p)), 'Pause : l\'état « En pause » s\'affiche');
    ok(state.ends >= 1, 'Pause : Gemini est prévenu de la fin du flux (audioStreamEnd)');
    const before = state.frames;
    await sleep(1500);
    ok(state.frames === before, 'Pause : plus rien n\'est envoyé pendant la pause');
    await p.evaluate(() => document.getElementById('player').play()); await sleep(1200);
    ok(state.frames > before && /Écoute en cours/.test(await status(p)), 'Reprise : l\'envoi et l\'écoute reprennent avec la lecture');
    turn('Nous reprenons le cours après la pause.'); await sleep(400);
    const h = await history(p);
    ok(h.length === 2 && /reprenons/.test(h[1]), 'Reprise : la traduction continue après la pause');
    await ctx.close();
  }

  // 2. Coupures passagères et clé refusée
  {
    const { ctx, state } = await context(browser, (ws, n) => {
      ws.send(JSON.stringify({ setupComplete: {} }));
      if (n === 1) setTimeout(() => ws.close({ code: 1008, reason: 'Quota exceeded for requests per minute' }), 500);
      if (n === 2) setTimeout(() => ws.close({ code: 1011, reason: 'Internal error' }), 500);
    });
    const p = await ctx.newPage();
    await live(p, 'mic');
    await p.click('#startBtn'); await sleep(4500);
    console.log(`   sessions ouvertes : ${state.setups}`);
    ok(state.setups >= 3 && /Écoute en cours/.test(await status(p)), 'Coupures passagères : reconnexion automatique, l\'écoute continue');
    await ctx.close();
  }
  {
    const { ctx } = await context(browser, (ws, n) => {
      ws.send(JSON.stringify({ setupComplete: {} }));
      setTimeout(() => ws.close({ code: 1008, reason: 'API key not valid. Please pass a valid API key.' }), 400);
    });
    const p = await ctx.newPage();
    await live(p, 'mic');
    await p.click('#startBtn'); await sleep(1500);
    ok(/Erreur/.test(await status(p)) && /Clé API/.test(await p.textContent('#alert')), 'Clé refusée : arrêt avec un message clair');
    await ctx.close();
  }
  {
    // Première connexion refusée par une erreur passagère : l'écoute démarre quand même.
    const { ctx, state } = await context(browser, (ws, n) => {
      if (n === 1) ws.close({ code: 1011, reason: 'Service unavailable' });
      else ws.send(JSON.stringify({ setupComplete: {} }));
    });
    const p = await ctx.newPage();
    await live(p, 'mic');
    await p.click('#startBtn'); await sleep(2500);
    ok(state.setups >= 2 && /Écoute en cours/.test(await status(p)), 'Premier échec passager : l\'écoute démarre et la connexion se rétablit');
    await ctx.close();
  }

  // 3. Message inattendu
  {
    const { ctx, state, turn } = await context(browser);
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await live(p, 'mic');
    await p.click('#startBtn'); await sleep(1000);
    state.ws.send('ceci n\'est pas du JSON'); state.ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{}] } } }));
    turn('Toujours là.', false); await sleep(400);
    ok(errors.length === 0 && (await history(p)).includes('Toujours là.'), 'Message inattendu : aucun plantage, la traduction continue');
    await ctx.close();
  }

  // 4. YouTube dans l'application
  for (const autoPause of [false, true]) {
    const { ctx, state, turn } = await context(browser);
    const p = await ctx.newPage();
    await live(p, 'youtube', true);
    if (autoPause) await p.check('#autoPause'); else await p.uncheck('#autoPause');
    ok(await p.isVisible('#ytCard'), `YouTube${autoPause ? ' (pause auto)' : ''} : la zone du lien apparaît`);
    await p.fill('#ytUrl', 'https://youtu.be/dQw4w9WgXcQ?si=abc');
    await p.click('#ytLoad'); await sleep(400);
    ok(/Vidéo prête/.test(await status(p)), 'YouTube : le lien est reconnu et la vidéo chargée');
    await p.click('#startBtn'); await sleep(1200);
    ok(await p.evaluate(() => window.__ytp.state) === 1, 'YouTube : Démarrer lance la vidéo');
    turn('Bonjour à tous, bienvenue dans ce cours.'); await sleep(700);
    const stateDuring = await p.evaluate(() => window.__ytp.state);
    await sleep(3000);
    const vols = await p.evaluate(() => window.__vols);
    if (!autoPause) {
      console.log('   volumes YouTube :', vols.join(' → '));
      ok(vols.includes(20) && vols.lastIndexOf(100) > vols.indexOf(20), 'YouTube : le volume baisse pendant la voix puis remonte');
      await p.evaluate(() => window.__ytp.pauseVideo()); await sleep(500);
      ok(/En pause/.test(await status(p)) && state.ends >= 1, 'YouTube : la pause de la vidéo est suivie (Gemini prévenu)');
      await p.evaluate(() => window.__ytp.playVideo()); await sleep(500);
      ok(/Écoute en cours/.test(await status(p)), 'YouTube : la lecture reprend l\'écoute');
    } else {
      ok(stateDuring === 2 && await p.evaluate(() => window.__ytp.state) === 1, 'YouTube : pause automatique pendant la voix, puis la vidéo repart seule');
      ok(/Écoute en cours/.test(await status(p)), 'YouTube : la pause automatique n\'affiche pas « En pause »');
    }
    await ctx.close();
  }
  await browser.close();
})();
