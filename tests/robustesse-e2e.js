// Tests de robustesse (« ça s'arrête et ça répète le même texte ») sur l'application réelle :
//  1. mode « Réunion sur ce téléphone » : la voix de la traduction est jouée (Gemini Live l'ignore à l'écoute) ;
//  2. une même traduction renvoyée deux fois n'est affichée qu'une fois ;
//  3. Gemini Live figé (parole entendue, aucune réponse) : nouvelle session sans reprise ;
//  4. reconnaissance Android qui renvoie tout le texte déjà reconnu : seuls les mots nouveaux sont gardés ;
//  5. autres moteurs en mode haut-parleur : l'écoute fait une pause pendant que la voix parle.
// Usage : node robustesse-e2e.js   (site servi sur http://localhost:8765)
const { chromium } = require('playwright');

const BASE = 'http://localhost:8765/';
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) process.exitCode = 1; };
const H = (texts) => texts.join(' | ');

async function liveContext(browser, onSetup) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  // Micro simulé : une tonalité continue, entendue comme de la parole.
  await ctx.addInitScript(() => {
    window.__played = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { window.__played++; return start.apply(this, a); };
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain();
      g.gain.value = 0.2; o.connect(g); const d = ac.createMediaStreamDestination(); g.connect(d); o.start();
      return d.stream;
    };
  });
  await ctx.routeWebSocket(/generativelanguage/, (ws) => ws.onMessage((raw) => {
    const m = JSON.parse(raw);
    if (m.setup) { ws.send(JSON.stringify({ setupComplete: {} })); onSetup(ws, m.setup); }
  }));
  return ctx;
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  // 1 + 2. Haut-parleur sans voix, et anti-répétition
  {
    let live; let liveSetup;
    const ctx = await liveContext(browser, (ws, setup) => { live = ws; liveSetup = setup; });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k');
    await p.check('#speak');
    await p.selectOption('#source', 'speaker');
    ok(await p.isEnabled('#speak') && await p.isChecked('#speak'), 'Haut-parleur : la voix de la traduction reste disponible');
    ok(/reconnue et ignorée/.test(await p.textContent('#sourceHint')), 'Haut-parleur : la protection anti-écho est expliquée');
    await p.click('#startBtn');
    await p.waitForTimeout(800);
    const audio = Buffer.alloc(4800).toString('base64');
    const turn = (en, fr) => {
      live.send(JSON.stringify({ serverContent: { inputTranscription: { text: en }, outputTranscription: { text: fr }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: audio } }] } } }));
      live.send(JSON.stringify({ serverContent: { turnComplete: true } }));
    };
    turn('Hello everyone.', 'Bonjour à tous.');
    await p.waitForTimeout(300);
    turn('Hello everyone.', 'Bonjour à tous.');      // même phrase renvoyée (reprise, écho…)
    await p.waitForTimeout(300);
    turn('Hello everyone!', 'Bonjour à tous !');     // variante de ponctuation
    await p.waitForTimeout(300);
    turn('Let us begin.', 'Commençons.');
    await p.waitForTimeout(500);
    const hist = await p.$$eval('#history .tr', (e) => e.map((x) => x.textContent));
    console.log('   historique :', H(hist));
    ok(hist.length === 2 && hist[1] === 'Commençons.', 'Anti-répétition : la phrase répétée n\'est affichée qu\'une fois, la suivante passe');
    ok(await p.evaluate(() => window.__played) >= 3, 'Haut-parleur : la voix de l\'interprète est bien jouée');
    ok(liveSetup && liveSetup.generationConfig.translationConfig.echoTargetLanguage === false, 'Haut-parleur : Gemini est réglé pour ignorer ce qui est déjà dans la langue cible');
    await ctx.close();
  }

  // 3. Session figée
  {
    const setups = [];
    const ctx = await liveContext(browser, (ws, setup) => {
      setups.push(setup.sessionResumption);
      if (setups.length === 1) ws.send(JSON.stringify({ sessionResumptionUpdate: { resumable: true, newHandle: 'FIGEE' } }));
      // ensuite : plus aucune réponse
    });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k'); await p.selectOption('#source', 'mic');
    await p.click('#startBtn');
    await p.waitForTimeout(15500);
    console.log('   sessions :', JSON.stringify(setups));
    ok(setups.length >= 2 && !setups[1].handle, 'Session figée : une nouvelle session est ouverte, sans reprendre l\'ancienne');
    ok(/nouvelle session/.test(await p.textContent('#alert')), 'Session figée : l\'utilisateur est prévenu');
    await ctx.close();
  }

  // 4. Reconnaissance Android cumulative
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      class FakeRec {
        start() {
          const mk = (t) => { const r = [{ transcript: t }]; r.isFinal = true; return r; };
          const send = (list, idx) => this.onresult({ resultIndex: idx, results: list.map(mk) });
          setTimeout(() => send(['Hello everyone'], 0), 200);
          setTimeout(() => send(['Hello everyone', 'Hello everyone today we study physics'], 1), 500);
          setTimeout(() => send(['Hello everyone', 'Hello everyone today we study physics', 'Hello everyone today we study physics'], 2), 800);
        }
        abort() {}
      }
      window.SpeechRecognition = FakeRec;
    });
    await ctx.route(/translate\.googleapis/, (r) => {
      const q = new URL(r.request().url()).searchParams.get('q');
      r.fulfill({ contentType: 'application/json', body: JSON.stringify([[[`[FR] ${q}`, q]]]) });
    });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.selectOption('#engine', 'browser'); await p.selectOption('#translator', 'google'); await p.selectOption('#source', 'mic');
    await p.click('#startBtn');
    await p.waitForTimeout(1500);
    const src = await p.$$eval('#history .src', (e) => e.map((x) => x.textContent));
    console.log('   reconnu :', H(src));
    ok(src.length === 2 && src[1] === 'today we study physics', 'Android : seuls les mots nouveaux sont gardés, sans répétition');
    await ctx.close();
  }
  // 5. Autres moteurs : pause d'écoute pendant la voix (synthèse vocale simulée)
  for (const speaking of [true, false]) {
    let requests = 0;
    const ctx = await liveContext(browser, () => {});
    await ctx.addInitScript((speaking) => {
      Object.defineProperty(window, 'speechSynthesis', { value: { speaking, speak() {}, cancel() {}, getVoices: () => [] } });
    }, speaking);
    await ctx.route('http://127.0.0.1:9/v1/audio/transcriptions', (r) => { requests++; r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"text":"hello"}' }); });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.selectOption('#engine', 'whisper'); await p.fill('#apiBase', 'http://127.0.0.1:9/v1'); await p.fill('#apiKey', 'k');
    await p.selectOption('#translator', 'google'); await p.selectOption('#source', 'speaker');
    await p.click('#startBtn');
    await p.waitForFunction(() => /Écoute en cours/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
    await p.waitForTimeout(16000); // son continu : un segment part au plus tard toutes les 14 s
    if (speaking) ok(requests === 0, 'Autres moteurs : rien n\'est envoyé à traduire pendant que la voix parle');
    else ok(requests > 0, 'Autres moteurs : l\'écoute reprend quand la voix se tait');
    await ctx.close();
  }
  await browser.close();
})();
