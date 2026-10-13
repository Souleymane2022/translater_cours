// Filme le tutoriel « ordinateur » (1920×1080) : un cours en ligne dans un onglet, l'application réelle
// dans un autre ; partage de l'audio de l'onglet, sous-titres flottants, traduction en direct.
// Comme pour record.js, seul Gemini Live est simulé (voir commun.js).
//
// Usage : node record-ordinateur.js <dossier_clips> <dossier_sortie>   (site servi sur localhost:8765)
const { chromium } = require('playwright');
const path = require('path');
const { sleep, now, loadManifest, mockGeminiLive, startRecording } = require('./commun');

const clipsDir = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const manifest = loadManifest(clipsDir);
const BASE = 'http://localhost:8765';
const events = [];

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });

  await context.addInitScript(() => {
    if (location.pathname !== '/') return;
    // Utilisateur déjà configuré : clé enregistrée, Gemini Live, français, lecture à voix haute.
    localStorage.setItem('traducteur-cours-settings', JSON.stringify({
      version: 2, source: 'mic', engine: 'live', srcLang: 'en-US', tgtLang: 'fr', translator: 'auto',
      speak: true, showOriginal: true, fontSize: '30', geminiKey: 'AIzaSyDemo-Cle-Gratuite-123',
    }));
    // Le partage d'onglet et la fenêtre flottante passent par le plateau (les vraies fenêtres du
    // navigateur ne peuvent pas être filmées) ; le son partagé est un flux silencieux.
    navigator.mediaDevices.getDisplayMedia = async () => {
      await window.parent.stage.share();
      return new AudioContext().createMediaStreamDestination().stream;
    };
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true, value: { requestWindow: () => window.parent.stage.openPip() },
    });
  });

  const { lecture } = await mockGeminiLive(context, events);
  const page = await context.newPage();
  await page.goto(`${BASE}/marketing/tutoriel/stage-ordinateur.html`);
  await page.evaluate(() => document.fonts.ready);
  const stage = (fn, ...args) => page.evaluate(([fn, args]) => window.stage[fn](...args), [fn, args]);
  await stage('load', `${BASE}/marketing/tutoriel/cours.html`, `${BASE}/`);
  let app = null;
  while (!app) { app = page.frames().find((f) => f.url() === `${BASE}/`); await sleep(100); }
  await app.waitForSelector('#startBtn');

  const stopRecording = await startRecording(context, page, outDir, events);

  const narrate = async (key, { wait = true, extra = 0.25, sub = true } = {}) => {
    const n = manifest.narration[key];
    events.push({ file: n.file, t: now(), kind: 'narration' });
    if (sub) await stage('sub', n.text);
    if (wait) await sleep((n.dur + extra) * 1000);
  };
  const clickAt = async ({ x, y }) => { await stage('move', x, y); await sleep(750); await stage('click', x, y); await sleep(250); };
  const clickApp = async (selector) => {
    const rect = await app.$eval(selector, (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await clickAt(await page.evaluate((r) => window.stage.appPoint(r), rect));
  };
  const clickStage = async (id) => clickAt(await page.evaluate((id) => window.stage.point(id), id));

  // ---------------- Scénario ----------------
  await narrate('d1', { sub: false, extra: 0.3 });
  await stage('card', 'intro', false);

  await stage('chip', '1', 'Ouvre ton cours dans un onglet');
  await stage('move', 900, 600);
  await narrate('d2', { extra: 0.4 });

  await stage('chip', '2', 'Dans l’application : « Audio d’un onglet »');
  const d3 = narrate('d3');
  await clickStage('tabApp');
  await stage('tab', 'app');
  await sleep(300);
  await clickApp('#source');
  await app.selectOption('#source', 'tab');
  await app.dispatchEvent('#source', 'change');
  await sleep(500);
  await clickApp('#startBtn');
  await d3;
  await app.click('#startBtn', { noWaitAfter: true });
  await sleep(500);

  await stage('chip', '3', 'Choisis l’onglet du cours + « Partager l’audio »');
  const d4 = narrate('d4');
  await clickStage('choice');
  await stage('shareStep', 'choice');
  await sleep(300);
  await clickStage('box');
  await stage('shareStep', 'audio');
  await sleep(300);
  await clickStage('shareBtn');
  await stage('shareStep', 'done');
  await d4;

  await stage('chip', '4', 'Active les sous-titres flottants');
  const d5 = narrate('d5');
  await clickApp('#pipBtn');
  await app.click('#pipBtn');
  await sleep(700);
  await clickStage('tabCourse');
  await stage('tab', 'course');
  await stage('move', 1700, 900);
  await d5;

  await stage('chip', '🎧', 'Le cours en anglais, traduit en direct');
  await stage('sub', 'Tu entends la prof 🇬🇧 <em>et</em> l’interprète 🇫🇷');
  await stage('course', 'play', true);
  await lecture(manifest.lecture.fr, (i) => { stage('course', 'slide', i); stage('course', 'talking', true); });
  await stage('course', 'talking', false);

  await stage('chip', '💻', 'Application Zoom sur Windows');
  const d6 = narrate('d6');
  await sleep(600);
  await stage('screenDialog', true);
  await d6;
  await stage('screenDialog', false);

  await stage('sub', '');
  await stage('chip', '', '');
  await stage('card', 'cta', true);
  await sleep(400);
  await narrate('d7', { sub: false, extra: 1.4 });

  await stopRecording();
  await browser.close();
})();
