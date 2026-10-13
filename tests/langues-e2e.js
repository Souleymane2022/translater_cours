// Test de bout en bout de l'application réelle : vraie voix → micro → Whisper local → vraie traduction → affichage.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const AUDIO_DIR = process.argv[2] || 'audio';
const CASES = [
  ['src_en.wav', 'en-US', 'fr'], ['src_en.wav', 'en-US', 'ar'], ['src_en.wav', 'en-US', 'es'],
  ['src_en.wav', 'en-US', 'sw'], ['src_en.wav', 'en-US', 'ha'], ['src_en.wav', 'en-US', 'zh-CN'],
  ['src_fr.wav', 'fr-FR', 'en'], ['src_es.wav', 'es-ES', 'fr'], ['src_pt.wav', 'pt-BR', 'fr'], ['src_it.wav', 'it-IT', 'ar'],
];
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  for (const [file, src, tgt] of CASES) {
    const ctxB = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' }); const p = await ctxB.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route('**/__test_audio.wav', r => r.fulfill({ body: fs.readFileSync(path.join(AUDIO_DIR, file)), contentType: 'audio/wav' }));
    await p.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(await (await fetch('/__test_audio.wav')).arrayBuffer());
        const s = ctx.createBufferSource(); s.buffer = audio;
        const dest = ctx.createMediaStreamDestination(); s.connect(dest); s.start(ctx.currentTime + 0.3);
        window.__audioSeconds = audio.duration;
        return dest.stream;
      };
    });
    await p.goto('http://localhost:8765/');
    await p.selectOption('#engine', 'whisper');
    await p.fill('#apiBase', 'http://127.0.0.1:8766/v1'); await p.fill('#apiKey', 'local'); await p.fill('#apiModel', 'whisper-small');
    await p.selectOption('#srcLang', src); await p.selectOption('#tgtLang', tgt); await p.selectOption('#translator', 'google');
    await p.click('#startBtn');
    await p.waitForFunction(() => window.__audioSeconds, null, { timeout: 10000 });
    const secs = await p.evaluate(() => window.__audioSeconds);
    await p.waitForTimeout((secs + 20) * 1000);
    const hist = await p.$$eval('#history li', els => els.map(li => ({ tr: li.querySelector('.tr').textContent, src: li.querySelector('.src').textContent, dir: getComputedStyle(li.querySelector('.tr')).direction })));
    const status = await p.textContent('#status');
    if (tgt === 'ar' && file === 'src_en.wav') await p.screenshot({ path: 'test-arabe.png', fullPage: true });
    results.push({ file, src, tgt, status, hist, errs });
    console.log(`\n=== ${file} ${src} → ${tgt}  (${status}) ${errs.length ? 'ERREURS: ' + errs : ''}`);
    for (const h of hist) console.log(`  [${h.dir}] ${h.tr}\n        ⟵ ${h.src}`);
    await ctxB.close();
  }
  fs.writeFileSync('matrix-results.json', JSON.stringify(results, null, 1));
  await b.close();
})();
