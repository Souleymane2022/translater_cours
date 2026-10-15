// Voix de secours : certaines langues (l'arabe) arrivent en texte sans voix, ou le téléphone n'a pas de voix
// pour la langue. La traduction doit quand même être lue à voix haute.
//  1. Gemini Live sans voix (arabe) : la voix de secours (Gemini TTS) lit les phrases, y compris les premières ;
//  2. Gemini Live avec sa voix (français) : aucune voix de secours ;
//  3. voix de Gemini un peu en retard : pas de double lecture ;
//  4. autres moteurs, téléphone sans voix arabe : voix de Google avec une clé ; sans clé, message d'aide.
// Usage : node voix-arabe-e2e.js   (site servi sur http://localhost:8765 ; Gemini Live et TTS simulés)
const { chromium } = require('playwright');

const BASE = 'http://localhost:8765/';
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pcm = (ms) => { const n = 24 * ms; const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2); return b; };
const wav = (data) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]).toString('base64');
};

async function setup(browser, { voices = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript((voices) => {
    window.__plays = 0; window.__spoken = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      const d = this.buffer.getChannelData(0); let s = 0; for (const v of d) s += v * v;
      if (Math.sqrt(s / d.length) > 0.004) window.__plays++;
      return start.apply(this, a);
    };
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
    if (voices) {
      Object.defineProperty(window, 'speechSynthesis', { value: {
        speaking: false, speak(u) { window.__spoken.push(u.text); }, cancel() {},
        getVoices: () => voices.map((lang) => ({ lang, name: lang })),
      } });
    }
  }, voices);
  const st = { ws: null, tts: [] };
  await ctx.route(/generativelanguage\.googleapis\.com\/v1beta\/models\/.*tts.*:generateContent/, async (r) => {
    st.tts.push(JSON.parse(r.request().postData()).contents[0].parts[0].text);
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav(pcm(800)) } }] } }] }) });
  });
  await ctx.routeWebSocket(/generativelanguage/, (ws) => ws.onMessage((raw) => {
    if (JSON.parse(raw).setup) { st.ws = ws; ws.send(JSON.stringify({ setupComplete: {} })); }
  }));
  const p = await ctx.newPage();
  await p.goto(BASE);
  return { ctx, p, st };
}
const say = (st, text, audio = false) => {
  const sc = { outputTranscription: { text }, inputTranscription: { text: 'x' } };
  if (audio) sc.modelTurn = { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm(800).toString('base64') } }] };
  st.ws.send(JSON.stringify({ serverContent: sc }));
  st.ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
};
const startLive = async (p, tgt) => {
  await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k'); await p.selectOption('#tgtLang', tgt);
  await p.check('#speak'); await p.selectOption('#source', 'mic');
  await p.click('#startBtn'); await sleep(800);
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  // 1. Arabe sans voix
  {
    const { ctx, p, st } = await setup(browser);
    await startLive(p, 'ar');
    say(st, 'مرحبا بكم في المحاضرة الأولى.');
    await sleep(1500);
    ok(st.tts.length === 0, 'Arabe : on laisse d\'abord à Gemini le temps d\'envoyer sa voix');
    await sleep(3500);
    ok(st.tts[0] === 'مرحبا بكم في المحاضرة الأولى.', 'Arabe : sans voix de Gemini, la voix de secours lit la première phrase');
    ok(/voix de secours/.test(await p.textContent('#alert')), 'Arabe : l\'utilisateur est prévenu');
    say(st, 'اليوم نتحدث عن الذكاء الاصطناعي.');
    await sleep(600);
    ok(st.tts.length === 2 && /الذكاء/.test(st.tts[1]), 'Arabe : les phrases suivantes sont lues aussitôt');
    await sleep(1500);
    ok(await p.evaluate(() => window.__plays) > 0, 'Arabe : la voix de secours est bien jouée');
    await ctx.close();
  }

  // 2. Français avec la voix de Gemini
  {
    const { ctx, p, st } = await setup(browser);
    await startLive(p, 'fr');
    say(st, 'Bonjour à tous.', true);
    await sleep(5000);
    say(st, 'Commençons.', true);
    await sleep(800);
    ok(st.tts.length === 0, 'Français : Gemini envoie sa voix, pas de voix de secours');
    await ctx.close();
  }

  // 3. Voix de Gemini un peu en retard
  {
    const { ctx, p, st } = await setup(browser);
    await startLive(p, 'ar');
    say(st, 'مرحبا بكم.');
    await sleep(2000);
    st.ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm(800).toString('base64') } }] } } }));
    await sleep(4000);
    ok(st.tts.length === 0, 'Voix en retard : pas de double lecture');
    await ctx.close();
  }

  // 4. Autres moteurs, téléphone sans voix arabe
  for (const withKey of [true, false]) {
    const { ctx, p, st } = await setup(browser, { voices: ['fr-FR', 'en-US'] });
    await ctx.addInitScript(() => {
      class FakeRec { start() { setTimeout(() => { const r = [{ transcript: 'Welcome to the first lecture.' }]; r.isFinal = true; this.onresult({ resultIndex: 0, results: [r] }); }, 300); } abort() {} }
      window.SpeechRecognition = FakeRec;
    });
    await ctx.route(/translate\.googleapis/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([[['مرحبا بكم في المحاضرة الأولى.', 'x']]]) }));
    await p.reload();
    if (withKey) await p.fill('#geminiKey', 'k'); // clé déjà enregistrée (zone repliée avec ce moteur)
    await p.selectOption('#engine', 'browser'); await p.selectOption('#translator', 'google'); await p.selectOption('#tgtLang', 'ar');
    await p.check('#speak'); await p.selectOption('#source', 'mic');
    await p.click('#startBtn'); await sleep(2500);
    const spoken = await p.evaluate(() => window.__spoken);
    if (withKey) ok(st.tts.length === 1 && spoken.length === 0, 'Autres moteurs : sans voix arabe sur le téléphone, la voix de Google lit la traduction');
    else ok(st.tts.length === 0 && /Synthèse vocale/.test(await p.textContent('#alert')), 'Autres moteurs, sans clé : message pour installer la voix arabe');
    await ctx.close();
  }
  await browser.close();
})();
