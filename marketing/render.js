// Filme demo.html image par image puis assemble la vidéo MP4 avec ffmpeg.
// Usage : node render.js [dossier_sortie] [--preview t1,t2,...]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const out = path.resolve(process.argv[2] || '.');
const previewArg = process.argv.indexOf('--preview');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(`file://${path.join(__dirname, 'demo.html')}?capture`);
  await page.evaluate(() => document.fonts.ready);

  if (previewArg > 0) {
    for (const t of process.argv[previewArg + 1].split(',').map(Number)) {
      await page.evaluate((t) => window.render(t), t);
      await page.screenshot({ path: path.join(out, `preview-${t}.jpg`), type: 'jpeg', quality: 80 });
    }
    await browser.close();
    return;
  }

  const framesDir = path.join(out, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const duration = await page.evaluate(() => window.DURATION);
  const total = Math.round(duration * FPS);
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    await page.screenshot({ path: path.join(framesDir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (i % 150 === 0) console.log(`image ${i}/${total}`);
  }
  await browser.close();

  const music = path.join(out, 'music.wav');
  const args = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, 'f%05d.jpg')];
  if (fs.existsSync(music)) args.push('-i', music, '-c:a', 'aac', '-b:a', '160k', '-shortest');
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(out, 'demo-traducteur-de-cours.mp4'));
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log('Vidéo prête :', path.join(out, 'demo-traducteur-de-cours.mp4'));
})();
