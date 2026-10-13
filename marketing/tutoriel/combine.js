// Réunit les tutoriels « téléphone » (vertical) et « ordinateur » (horizontal) en une seule vidéo,
// dans les deux formats :
//   - verticale 1080×1920 : téléphone → ordinateur (recadré, grands sous-titres) → carte finale ;
//   - horizontale 1920×1080 : téléphone (recadré, grands sous-titres) → ordinateur.
//
// Usage : node combine.js <rec_telephone> <clips_telephone> <video_telephone.mp4>
//                         <rec_ordinateur> <clips_ordinateur> <video_ordinateur.mp4> <dossier_sortie>
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadManifest } = require('./commun');

const [recPhone, clipsPhone, mp4Phone, recPc, clipsPc, mp4Pc, outDir] = process.argv.slice(2).map((p) => path.resolve(p));
const FADE = 0.5;
fs.mkdirSync(outDir, { recursive: true });
const tmp = (name) => path.join(outDir, name);
const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const ENC = ['-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];

const phone = { tl: JSON.parse(fs.readFileSync(path.join(recPhone, 'timeline.json'))), m: loadManifest(clipsPhone) };
const pc = { tl: JSON.parse(fs.readFileSync(path.join(recPc, 'timeline.json'))), m: loadManifest(clipsPc) };
const narrationStart = (part, key) => part.tl.events.find((e) => e.file === part.m.narration[key].file).t;
// La carte finale apparaît ~0,4 s avant la dernière narration : on coupe juste avant.
const phoneCut = narrationStart(phone, 'n8') - 0.55;
const pcCut = narrationStart(pc, 'd7') - 0.55;

// ---------- Sous-titres (ASS) ----------
const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
function captions(part, until, demoTexts) {
  const lines = [];
  for (const [key, n] of Object.entries(part.m.narration)) {
    const ev = part.tl.events.find((e) => e.file === n.file);
    if (ev && ev.t < until) lines.push([ev.t, Math.min(until, ev.t + n.dur + 0.2), n.text]);
  }
  // Pendant chaque démonstration (prof + interprète d'une même langue), une ligne d'explication.
  for (const [lang, text] of Object.entries(demoTexts)) {
    const files = new Set(part.m.lecture[lang].flatMap((it) => [it.prof, it.interp].filter(Boolean)));
    const evs = part.tl.events.filter((e) => files.has(e.file));
    if (!evs.length) continue;
    const durOf = (e) => { for (const it of part.m.lecture[lang]) { if (it.prof === e.file) return it.prof_dur; if (it.interp === e.file) return it.interp_dur; } return 0; };
    lines.push([evs[0].t, Math.min(until, Math.max(...evs.map((e) => e.t + durOf(e))) + 1), text]);
  }
  return lines.sort((a, b) => a[0] - b[0]);
}
function writeAss(file, { w, h, align, ml, mr, mv, size }, lines) {
  fs.writeFileSync(file, `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Inter,${size},&H00FFFFFF,&H00FFFFFF,&H00201008,&H00201008,-1,0,0,0,100,100,0,0,1,0,0,${align},${ml},${mr},${mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.map(([a, b, t]) => `Dialogue: 0,${assTime(a)},${assTime(b)},Default,,0,0,0,,${t.replace(/\n/g, ' ')}`).join('\n')}
`);
}

// ---------- Fonds (HTML → PNG) ----------
const BG_CSS = `* { margin: 0; box-sizing: border-box; } body { font-family: Inter, "Noto Color Emoji", sans-serif; color: #fff;
  background: radial-gradient(1100px 900px at 85% 0%, rgba(29,78,216,.6), transparent 70%), radial-gradient(800px 800px at 0% 100%, rgba(250,204,21,.14), transparent 70%), linear-gradient(170deg, #0b1020, #172554); }
  h1 { font-family: "Inter Display", Inter, sans-serif; font-weight: 900; letter-spacing: -.02em; } h1 em { font-style: normal; color: #facc15; }
  .apps { color: #cbd5e1; font-weight: 700; }`;
async function backgrounds() {
  const browser = await chromium.launch();
  const shot = async (w, h, html, file) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${BG_CSS} body { width: ${w}px; height: ${h}px; }</style></head><body>${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file });
    await page.close();
  };
  await shot(1080, 1920, `<div style="position:absolute;top:150px;left:0;right:0;text-align:center">
      <div style="font-size:120px">💻</div><h1 style="font-size:96px;margin-top:20px">Sur <em>ordinateur</em></h1>
      <p class="apps" style="font-size:40px;margin-top:26px">YouTube • Coursera • Zoom • Google Meet</p></div>`, tmp('fond-vertical.png'));
  await shot(1920, 1080, `<div style="position:absolute;top:110px;left:110px;width:950px">
      <div style="font-size:96px">📱</div><h1 style="font-size:84px;margin-top:14px">Sur <em>téléphone</em></h1>
      <p class="apps" style="font-size:34px;margin-top:18px">Cours en salle, réunions, vidéos</p></div>`, tmp('fond-horizontal.png'));
  await browser.close();
}

(async () => {
  await backgrounds();

  // Segments verticaux
  ffmpeg(['-i', mp4Phone, '-t', phoneCut.toFixed(2), ...ENC, tmp('v1.mp4')]);
  writeAss(tmp('pc.ass'), { w: 1080, h: 1920, align: 8, ml: 70, mr: 70, mv: 1250, size: 54 },
    captions(pc, pcCut, { fr: 'Tu entends la prof (anglais) et l’interprète (français)' }));
  ffmpeg(['-loop', '1', '-i', tmp('fond-vertical.png'), '-i', mp4Pc, '-t', pcCut.toFixed(2),
    '-filter_complex', `[1:v]scale=1080:608[v];[0:v][v]overlay=0:590:shortest=1,ass=${tmp('pc.ass')}[out]`,
    '-map', '[out]', '-map', '1:a', ...ENC, tmp('v2.mp4')]);
  ffmpeg(['-ss', phoneCut.toFixed(2), '-i', mp4Phone, ...ENC, tmp('v3.mp4')]);

  // Segments horizontaux
  writeAss(tmp('phone.ass'), { w: 1920, h: 1080, align: 7, ml: 110, mr: 860, mv: 470, size: 50 },
    captions(phone, phoneCut, {
      fr: 'Tu entends le prof (anglais) et l’interprète (français)',
      es: 'Tu entends le prof (anglais) et l’interprète (espagnol)',
      ar: 'Le texte arabe s’affiche de droite à gauche',
    }));
  ffmpeg(['-loop', '1', '-i', tmp('fond-horizontal.png'), '-i', mp4Phone, '-t', phoneCut.toFixed(2),
    '-filter_complex', `[1:v]scale=608:1080[v];[0:v][v]overlay=1190:0:shortest=1,ass=${tmp('phone.ass')}[out]`,
    '-map', '[out]', '-map', '1:a', ...ENC, tmp('h1.mp4')]);
  ffmpeg(['-i', mp4Pc, ...ENC, tmp('h2.mp4')]);

  // Assemblage avec fondus enchaînés
  const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
  const join = (files, out) => {
    const inputs = files.flatMap((f) => ['-i', f]);
    const parts = []; let v = '[0:v]'; let a = '[0:a]'; let offset = 0;
    for (let i = 1; i < files.length; i++) {
      offset += dur(files[i - 1]) - FADE;
      parts.push(`${v}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[v${i}]`);
      parts.push(`${a}[${i}:a]acrossfade=d=${FADE}[a${i}]`);
      v = `[v${i}]`; a = `[a${i}]`;
    }
    ffmpeg([...inputs, '-filter_complex', parts.join(';'), '-map', v, '-map', a,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  };
  join([tmp('v1.mp4'), tmp('v2.mp4'), tmp('v3.mp4')], tmp('complet-vertical.mp4'));
  join([tmp('h1.mp4'), tmp('h2.mp4')], tmp('complet-horizontal.mp4'));
  console.log('Vidéos prêtes :', tmp('complet-vertical.mp4'), tmp('complet-horizontal.mp4'));
})();
