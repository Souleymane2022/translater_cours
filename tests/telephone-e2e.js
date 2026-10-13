// Tests des fonctions « téléphone » de l'application réelle (Chromium) :
//  1. fichier audio traduit pendant la lecture (vraie voix → Whisper local → Google Traduction) ;
//  2. source « Réunion sur ce téléphone » : micro sans annulation d'écho ni réduction de bruit ;
//  3. sous-titres flottants par Picture-in-Picture vidéo (Android / iOS) ;
//  4. fichier reçu par « Partager → Traducteur de Cours » (service worker, share target).
// Usage : node telephone-e2e.js <voix_espagnol.wav> <dossier_sortie>   (site sur :8765, Whisper local sur :8766)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [wav, outDir] = process.argv.slice(2).map((p) => path.resolve(p));
const BASE = 'http://localhost:8765/';
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) process.exitCode = 1; };
const setWhisper = async (p) => {
  await p.selectOption('#engine', 'whisper');
  await p.fill('#apiBase', 'http://127.0.0.1:8766/v1'); await p.fill('#apiKey', 'local'); await p.fill('#apiModel', 'whisper-small');
  await p.selectOption('#srcLang', 'es-ES'); await p.selectOption('#tgtLang', 'fr'); await p.selectOption('#translator', 'google');
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  // 1. Fichier audio
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 400, height: 860 } });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await setWhisper(p);
    await p.selectOption('#source', 'file');
    ok(await p.isVisible('#playerCard'), 'Fichier : le lecteur apparaît quand on choisit cette source');
    await p.setInputFiles('#fileInput', wav);
    ok((await p.textContent('#fileName')).endsWith('.wav'), 'Fichier : le nom du fichier choisi s\'affiche');
    await p.click('#startBtn');
    await p.waitForFunction(() => /Lecture terminée/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
    const tr = await p.$$eval('#history .tr', (e) => e.map((x) => x.textContent));
    console.log('   traduction :', tr.join(' | '));
    ok(tr.length > 0 && /fraction/i.test(tr.join(' ')), 'Fichier : la voix espagnole est traduite en français et l\'écoute s\'arrête seule en fin de lecture');
    await ctx.close();
  }

  // 2. Réunion sur ce téléphone
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => { window.__constraints = c; return real(c); };
    });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await setWhisper(p);
    await p.selectOption('#source', 'speaker');
    await p.click('#startBtn');
    await p.waitForTimeout(800);
    const c = await p.evaluate(() => window.__constraints);
    ok(c && c.audio.echoCancellation === false && c.audio.noiseSuppression === false, 'Haut-parleur : le micro est ouvert sans annulation d\'écho ni réduction de bruit');
    ok(/Réunion sur ce téléphone/.test(await p.textContent('#sourceHint')), 'Haut-parleur : la marche à suivre s\'affiche');
    await ctx.close();
  }

  // 3. Sous-titres flottants (Picture-in-Picture vidéo, comme sur Android / iOS)
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    let live = null;
    await ctx.routeWebSocket(/generativelanguage/, (ws) => ws.onMessage((raw) => {
      if (JSON.parse(raw).setup) { live = ws; ws.send(JSON.stringify({ setupComplete: {} })); }
    }));
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'documentPictureInPicture', { value: undefined });
      delete window.documentPictureInPicture;
      Object.defineProperty(document, 'pictureInPictureEnabled', { value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async function () { window.__pipVideo = this; return {}; };
    });
    const p = await ctx.newPage();
    await p.goto(BASE);
    ok(await p.isVisible('#pipBtn'), 'Flottant : le bouton est proposé sans Document PiP (téléphone)');
    await p.selectOption('#engine', 'live'); await p.fill('#geminiKey', 'k'); await p.selectOption('#tgtLang', 'ar');
    await p.selectOption('#source', 'speaker');
    await p.click('#startBtn');
    await p.waitForTimeout(600);
    await p.click('#pipBtn');
    await p.waitForTimeout(300);
    ok(await p.evaluate(() => !!window.__pipVideo), 'Flottant : une vidéo est envoyée en Picture-in-Picture');
    live.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Welcome to the first lecture.' }, outputTranscription: { text: 'مرحبا بكم في المحاضرة الأولى.' } } }));
    await p.waitForTimeout(900);
    const png = await p.evaluate(async () => {
      const v = window.__pipVideo;
      const c = Object.assign(document.createElement('canvas'), { width: v.videoWidth, height: v.videoHeight });
      c.getContext('2d').drawImage(v, 0, 0); return c.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(outDir, 'pip-telephone.png'), Buffer.from(png.split(',')[1], 'base64'));
    ok(png.length > 2000, 'Flottant : la vidéo flottante contient une image (voir pip-telephone.png)');
    await ctx.close();
  }

  // 4. Partage depuis une autre application (share target)
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload();
    await p.evaluate(() => navigator.serviceWorker.controller || new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r)));
    const bytes = [...fs.readFileSync(wav)];
    await p.evaluate((bytes) => {
      const form = Object.assign(document.createElement('form'), { method: 'POST', action: './?share-target', enctype: 'multipart/form-data' });
      const input = Object.assign(document.createElement('input'), { type: 'file', name: 'media' });
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'message-vocal.wav', { type: 'audio/wav' }));
      input.files = dt.files;
      form.append(input); document.body.append(form); form.submit();
    }, bytes);
    await p.waitForURL((u) => !u.search.includes('share-target'), { timeout: 10000 });
    await p.waitForTimeout(1500);
    ok(await p.inputValue('#source') === 'file', 'Partage : l\'application s\'ouvre en mode fichier');
    ok((await p.textContent('#fileName')) === 'message-vocal.wav', 'Partage : le fichier partagé est chargé dans le lecteur');
    ok(/Fichier reçu/.test(await p.textContent('#status')), 'Partage : un message invite à appuyer sur Démarrer');
    ok(!p.url().includes('shared'), 'Partage : l\'adresse est nettoyée');
    await ctx.close();
  }
  await browser.close();
})();
