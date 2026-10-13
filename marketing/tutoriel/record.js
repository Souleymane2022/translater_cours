// Filme le tutoriel : pilote l'application réelle dans stage.html, enregistre l'écran (CDP screencast)
// et note l'instant de chaque voix pour assembler ensuite le son (voir build.sh).
//
// Gemini Live est remplacé par un serveur simulé qui renvoie, au rythme de la parole, le texte du
// professeur et sa traduction (vraie traduction Google préparée par prepare.py) ainsi que la voix
// de l'interprète. Tout le reste est l'application réelle.
//
// Usage : node record.js <dossier_clips> <dossier_sortie>   (le site doit être servi sur localhost:8765)
const { chromium } = require('playwright');
const path = require('path');
const { sleep, now, loadManifest, mockGeminiLive, startRecording } = require('./commun');

const clipsDir = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const manifest = loadManifest(clipsDir);
const BASE = 'http://localhost:8765';
const events = []; // { file, t (s, horloge murale), kind }

(async () => {
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

  const { lecture: runLecture } = await mockGeminiLive(context, events);

  const page = await context.newPage();
  await page.goto(`${BASE}/marketing/tutoriel/stage.html`);
  await page.evaluate(() => document.fonts.ready);
  const stage = (fn, ...args) => page.evaluate(([fn, args]) => window.stage[fn](...args), [fn, args]);

  const stopRecording = await startRecording(context, page, outDir, events);

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
  async function lecture(lang) {
    // Le démarrage de l'application modifie la mise en page : on recadre sur la zone de traduction.
    await app.$eval('#stage', (el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    await sleep(500);
    await runLecture(manifest.lecture[lang]);
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

  await stopRecording();
  await browser.close();
})();
