// La voix de l'interprète doit lire tout le texte : Gemini envoie la voix par rafales (plus vite que le temps
// réel) mêlée de silences. Avant correction, au-delà de 3 s de retard l'application « sautait au direct » :
// les morceaux se superposaient et la voix était hachée, incomplète.
// Vérifie : tous les morceaux de parole sont joués, aucun ne se superpose, les silences en attente sont
// retirés, la voix accélère au plus de 15 %.
// Usage : node voix-sync-e2e.js   (site servi sur http://localhost:8765)
const { chromium } = require('playwright');

const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (audible) => {
  const b = Buffer.alloc(2400 * 2); // 100 ms à 24 kHz
  if (audible) for (let i = 0; i < 2400; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2);
  return b.toString('base64');
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    window.__plays = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, ...a) {
      const d = this.buffer.getChannelData(0); let s = 0; for (const v of d) s += v * v;
      window.__plays.push({ when, dur: this.buffer.duration / this.playbackRate.value, rate: this.playbackRate.value, audible: Math.sqrt(s / d.length) > 0.004 });
      return start.call(this, when, ...a);
    };
  });
  let ws;
  await ctx.routeWebSocket(/generativelanguage/, (w) => w.onMessage((raw) => {
    if (JSON.parse(raw).setup) { ws = w; w.send(JSON.stringify({ setupComplete: {} })); }
  }));
  const p = await ctx.newPage();
  await p.goto('http://localhost:8765/');
  await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k'); await p.check('#speak'); await p.selectOption('#source', 'mic');
  await p.click('#startBtn'); await sleep(1000);
  // Rafale : 50 morceaux de parole (5 s) et 30 silences, envoyés en 0,5 s.
  const order = [];
  for (let i = 0; i < 80; i++) order.push(i % 8 < 5 ? 'v' : 's');
  for (let i = 0; i < order.length; i += 8) {
    ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: order.slice(i, i + 8).map((k) => ({ inlineData: { mimeType: 'audio/pcm;rate=24000', data: chunk(k === 'v') } })) } } }));
    await sleep(50);
  }
  await sleep(500);
  const plays = await p.evaluate(() => window.__plays);
  const voice = plays.filter((x) => x.audible);
  const sorted = [...plays].sort((a, b) => a.when - b.when);
  let overlaps = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].when < sorted[i - 1].when + sorted[i - 1].dur - 0.001) overlaps++;
  const silences = plays.length - voice.length;
  const maxRate = Math.max(...plays.map((x) => x.rate));
  console.log(`   parole jouée : ${voice.length}/50 morceaux · silences gardés : ${silences}/30 · superpositions : ${overlaps} · vitesse max : ×${maxRate}`);
  ok(voice.length === 50, 'Tous les morceaux de parole sont joués (rien n\'est sauté)');
  ok(overlaps === 0, 'Aucun morceau ne se superpose à un autre');
  ok(silences < 30, 'Les silences en attente sont retirés quand la voix est en retard');
  ok(maxRate <= 1.15, 'La voix accélère au plus de 15 % pour rattraper');

  // Connexion irrégulière : 4 s de voix en temps réel, chaque morceau arrivant avec un retard aléatoire.
  await sleep(6000);
  await p.evaluate(() => { window.__plays = []; });
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const due = t0 + i * 100 + rand() * 180; // jusqu'à 180 ms de retard
    await sleep(Math.max(0, due - Date.now()));
    ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: chunk(true) } }] } } }));
  }
  await sleep(800);
  const live = (await p.evaluate(() => window.__plays)).filter((x) => x.audible).sort((a, b) => a.when - b.when);
  let gaps = 0;
  for (let i = 1; i < live.length; i++) if (live[i].when > live[i - 1].when + live[i - 1].dur + 0.005) gaps++;
  let rateChanges = 0;
  for (let i = 1; i < live.length; i++) if (live[i].rate !== live[i - 1].rate) rateChanges++;
  console.log(`   connexion irrégulière : ${live.length}/40 morceaux · trous dans la voix : ${gaps} · changements de vitesse : ${rateChanges}`);
  ok(live.length === 40 && gaps === 0, 'Connexion irrégulière : la voix reste continue, sans trous');
  ok(rateChanges <= 1, 'La vitesse de la voix ne change pas en permanence');

  // Autres moteurs : la synthèse vocale du téléphone ne doit abandonner aucune phrase.
  const ctx2 = await browser.newContext({ serviceWorkers: 'block' });
  await ctx2.addInitScript(() => {
    window.__spoken = []; window.__cancels = 0;
    const queue = [];
    Object.defineProperty(window, 'speechSynthesis', { value: {
      get speaking() { return queue.length > 0; },
      speak(u) { window.__spoken.push([u.text, u.rate]); queue.push(u); setTimeout(() => { queue.shift(); u.onend && u.onend(); }, 1500 * queue.length); },
      cancel() { window.__cancels++; queue.length = 0; }, getVoices: () => [],
    } });
    class FakeRec {
      start() {
        const mk = (t) => { const r = [{ transcript: t }]; r.isFinal = true; return r; };
        ['One.', 'Two two.', 'Three three three.', 'Four four four four.', 'Five five five five five.']
          .forEach((t, i) => setTimeout(() => this.onresult({ resultIndex: 0, results: [mk(t)] }), 200 + i * 150));
      }
      abort() {}
    }
    window.SpeechRecognition = FakeRec;
  });
  await ctx2.route(/translate\.googleapis/, (r) => { const q = new URL(r.request().url()).searchParams.get('q'); r.fulfill({ contentType: 'application/json', body: JSON.stringify([[[`FR ${q}`, q]]]) }); });
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:8765/');
  await p2.selectOption('#engine', 'browser'); await p2.selectOption('#translator', 'google'); await p2.check('#speak'); await p2.selectOption('#source', 'mic');
  await p2.click('#startBtn'); await sleep(2000);
  const spoken = await p2.evaluate(() => window.__spoken);
  console.log('   phrases lues :', spoken.map(([t, r]) => `${t} (×${r})`).join(' | '));
  ok(spoken.length === 5 && await p2.evaluate(() => window.__cancels) === 0, 'Synthèse vocale : les 5 phrases sont lues, aucune n\'est abandonnée');
  ok(spoken[spoken.length - 1][1] > spoken[0][1], 'Synthèse vocale : la voix accélère quand des phrases attendent');
  await browser.close();
})();
