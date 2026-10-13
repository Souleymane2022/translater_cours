// Traducteur de Cours — reconnaissance vocale + traduction en temps réel.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SpeechRecognition = self.SpeechRecognition || self.webkitSpeechRecognition;

  const SETTINGS_KEY = 'traducteur-cours-settings';
  const SETTING_FIELDS = ['source', 'engine', 'srcLang', 'tgtLang', 'translator', 'apiBase', 'apiModel', 'apiKey', 'speak', 'showOriginal', 'fontSize'];

  // Phrases que Whisper « invente » souvent sur du silence ou de la musique.
  const WHISPER_HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.+|subtitles by .*|please subscribe.*)$/i;

  // ---------- Réglages ----------

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { /* stockage indisponible */ }
    for (const id of SETTING_FIELDS) {
      const el = $(id);
      if (!(id in saved)) continue;
      if (el.type === 'checkbox') el.checked = !!saved[id];
      else el.value = saved[id];
    }
    if (!$('apiBase').value) $('apiBase').value = 'https://api.openai.com/v1';
    if (!$('apiModel').value) $('apiModel').value = 'gpt-4o-mini-transcribe';
  }

  function saveSettings() {
    const data = {};
    for (const id of SETTING_FIELDS) {
      const el = $(id);
      data[id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* ignoré */ }
  }

  function applyDisplaySettings() {
    document.documentElement.style.setProperty('--font-size', `${$('fontSize').value}px`);
    document.body.classList.toggle('hide-original', !$('showOriginal').checked);
    if (pipWindow) {
      pipWindow.document.documentElement.style.setProperty('--font-size', `${$('fontSize').value}px`);
      pipWindow.document.body.classList.toggle('hide-original', !$('showOriginal').checked);
    }
    $('whisperSettings').open = $('engine').value === 'whisper';
    updateHint();
  }

  function updateHint() {
    const source = $('source').value;
    const engine = $('engine').value;
    const hints = [];
    if (engine === 'browser' && !SpeechRecognition) {
      hints.push('⚠️ Ce navigateur ne propose pas la reconnaissance vocale : utilisez Chrome ou Edge, ou le moteur Whisper.');
    }
    if (source === 'mic') {
      hints.push('Placez l\'appareil près de l\'enseignant ou des haut-parleurs. Pour Zoom/Teams sur ce même ordinateur, '
        + 'le micro capte le son des haut-parleurs : baissez le volume du micro dans Zoom (ou coupez-le) pendant la traduction.');
    } else {
      hints.push('Une fenêtre va s\'ouvrir : choisissez l\'onglet de la réunion (Zoom web, Google Meet, Teams web, YouTube…) '
        + 'et cochez « Partager l\'audio de l\'onglet ». Pour l\'application Zoom de bureau, choisissez « Écran entier » '
        + 'et cochez « Partager l\'audio du système » (Windows).');
      if (engine === 'browser') {
        hints.push('Si votre navigateur ne sait pas reconnaître l\'audio d\'un onglet, il écoutera le micro à la place : '
          + 'dans ce cas, utilisez le moteur Whisper (clé gratuite chez Groq).');
      }
    }
    if ($('speak').checked) hints.push('🎧 Avec la lecture à voix haute, utilisez des écouteurs pour que le micro ne capte pas la voix française.');
    $('sourceHint').textContent = hints.join(' ');
  }

  // ---------- Affichage ----------

  function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text;
    el.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function stageDoc() { return pipWindow ? pipWindow.document : document; }

  function showLive(translation, original, interim) {
    const doc = stageDoc();
    const tr = doc.getElementById('liveTr');
    const src = doc.getElementById('liveSrc');
    if (!tr) return;
    tr.textContent = lastChars(translation, 400);
    tr.classList.toggle('interim', !!interim);
    src.textContent = lastChars(original, 300);
  }

  function lastChars(text, max) {
    if (!text || text.length <= max) return text || '';
    const cut = text.indexOf(' ', text.length - max);
    return `… ${text.slice(cut > 0 ? cut + 1 : text.length - max)}`;
  }

  function addHistoryItem(original) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    const now = new Date();
    time.dateTime = now.toISOString();
    time.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const tr = document.createElement('div');
    tr.className = 'tr';
    tr.textContent = '…';
    const src = document.createElement('div');
    src.className = 'src';
    src.textContent = original;
    li.append(time, tr, src);
    const list = $('history');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.append(li);
    if (atBottom) list.scrollTop = list.scrollHeight;
    return {
      setTranslation(text) { tr.textContent = text; li.dataset.tr = text; },
      setError(msg) { tr.textContent = `⚠️ ${msg}`; },
    };
  }

  // ---------- Synthèse vocale (lecture en français) ----------

  let pendingUtterances = 0;

  function speak(text) {
    if (!$('speak').checked || !('speechSynthesis' in self) || !text) return;
    // Si on prend trop de retard sur l'orateur, on abandonne les anciennes phrases.
    if (pendingUtterances > 2) {
      speechSynthesis.cancel();
      pendingUtterances = 0;
    }
    const lang = $('tgtLang').value;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1.1;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
    pendingUtterances++;
    u.onend = u.onerror = () => { pendingUtterances = Math.max(0, pendingUtterances - 1); };
    speechSynthesis.speak(u);
  }

  // ---------- Traduction ----------

  const translator = new self.TranslationService();
  let interimTimer = null;
  let interimAbort = null;
  let latestInterim = '';
  let lastFinal = { original: '', translation: '' };
  let finalChain = Promise.resolve();

  function onInterim(text) {
    latestInterim = text;
    showLive(lastFinal.translation, text, true);
    if (interimTimer) return;
    interimTimer = setTimeout(async () => {
      interimTimer = null;
      const text = latestInterim;
      if (!text) return;
      if (interimAbort) interimAbort.abort();
      interimAbort = new AbortController();
      try {
        const tr = await translator.translate(text, interimAbort.signal);
        if (text === latestInterim) showLive(tr, text, true);
      } catch { /* la phrase finale sera traduite de toute façon */ }
    }, 700);
  }

  function onFinal(text) {
    text = text.trim();
    if (!text) return;
    latestInterim = '';
    if (interimAbort) interimAbort.abort();
    const item = addHistoryItem(text);
    const pending = translator.translate(text);
    // Les requêtes partent en parallèle mais l'affichage et la lecture respectent l'ordre.
    finalChain = finalChain.then(async () => {
      try {
        const tr = await pending;
        item.setTranslation(tr);
        lastFinal = { original: text, translation: tr };
        if (!latestInterim) showLive(tr, text, false);
        speak(tr);
      } catch (err) {
        item.setError(`traduction impossible (${err.message})`);
      }
    });
  }

  // ---------- Moteur 1 : reconnaissance vocale du navigateur ----------

  class BrowserEngine {
    constructor({ lang, track }, handlers) {
      this.lang = lang;
      this.track = track;
      this.handlers = handlers;
      this.running = false;
    }

    start() {
      this.running = true;
      this.rec = new SpeechRecognition();
      this.rec.lang = this.lang;
      this.rec.continuous = true;
      this.rec.interimResults = true;
      this.rec.maxAlternatives = 1;

      this.rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) this.handlers.onFinal(r[0].transcript);
          else interim += r[0].transcript;
        }
        if (interim) this.handlers.onInterim(interim);
      };

      this.rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          this.running = false;
          this.handlers.onFatal('Accès au micro refusé ou indisponible. Autorisez le micro pour ce site.');
          return;
        }
        if (e.error === 'language-not-supported') {
          this.running = false;
          this.handlers.onFatal('Langue non prise en charge par la reconnaissance du navigateur.');
          return;
        }
        this.handlers.onWarning(`Reconnaissance : ${e.error}`);
      };

      // Chrome coupe la reconnaissance régulièrement : on la relance tant que l'utilisateur n'a pas arrêté.
      this.rec.onend = () => {
        if (!this.running) return;
        if (this.track && this.track.readyState === 'ended') {
          this.running = false;
          this.handlers.onFatal('Le partage audio a été arrêté.');
          return;
        }
        setTimeout(() => this.running && this.launch(), 250);
      };

      this.launch();
    }

    launch() {
      try {
        if (this.track) this.rec.start(this.track);
        else this.rec.start();
      } catch (err) {
        if (err.name !== 'InvalidStateError') this.handlers.onFatal(err.message);
      }
    }

    stop() {
      this.running = false;
      if (this.rec) {
        this.rec.onend = null;
        try { this.rec.abort(); } catch { /* déjà arrêté */ }
      }
    }
  }

  // ---------- Moteur 2 : Whisper (API compatible OpenAI) ----------

  class WhisperEngine {
    constructor({ stream, lang, apiBase, apiKey, model }, handlers) {
      this.stream = new MediaStream(stream.getAudioTracks());
      this.lang = lang.split('-')[0];
      this.apiBase = apiBase.replace(/\/+$/, '');
      this.apiKey = apiKey;
      this.model = model;
      this.handlers = handlers;
      this.running = false;
      this.chain = Promise.resolve();
      this.mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((t) => self.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    }

    start() {
      if (!self.MediaRecorder) throw new Error('MediaRecorder non pris en charge par ce navigateur.');
      this.running = true;
      this.ctx = new AudioContext();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.newSegment();
      // Détection simple de la voix : on coupe un segment dès qu'une pause suit de la parole.
      this.timer = setInterval(() => this.tick(), 100);
      this.stream.getAudioTracks()[0].addEventListener('ended', () => {
        if (this.running) this.handlers.onFatal('Le partage audio a été arrêté.');
      });
    }

    newSegment() {
      const rec = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
      const chunks = [];
      const seg = { rec, startedAt: performance.now(), speechMs: 0, silenceMs: 0 };
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        if (seg.discard || !chunks.length) return;
        this.enqueue(new Blob(chunks, { type: rec.mimeType || this.mimeType }));
      };
      rec.start();
      this.segment = seg;
    }

    tick() {
      if (!this.running) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += v * v;
      const rms = Math.sqrt(sum / this.buf.length);
      const seg = this.segment;
      if (rms > 0.012) { seg.speechMs += 100; seg.silenceMs = 0; } else { seg.silenceMs += 100; }

      const age = performance.now() - seg.startedAt;
      const pauseAfterSpeech = seg.speechMs >= 400 && seg.silenceMs >= 700 && age >= 2000;
      if (pauseAfterSpeech || age >= 14000) {
        seg.discard = seg.speechMs < 400; // rien d'audible : inutile d'envoyer
        seg.rec.stop();
        this.newSegment();
      }
      this.handlers.onInterim(seg.speechMs > 0 && seg.silenceMs < 700 ? '🎙️ …' : '');
    }

    enqueue(blob) {
      const request = this.transcribe(blob);
      this.chain = this.chain.then(async () => {
        try {
          const text = (await request).trim();
          if (text && !WHISPER_HALLUCINATIONS.test(text)) this.handlers.onFinal(text);
        } catch (err) {
          this.handlers.onWarning(`Whisper : ${err.message}`);
          if (/401|403/.test(err.message)) this.handlers.onFatal('Clé API refusée. Vérifiez la clé et l\'URL de l\'API.');
        }
      });
    }

    async transcribe(blob) {
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', blob, `segment.${ext}`);
      form.append('model', this.model);
      form.append('language', this.lang);
      form.append('response_format', 'json');
      const res = await fetch(`${this.apiBase}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error.message; } catch { /* corps non JSON */ }
        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
      }
      return (await res.json()).text || '';
    }

    stop() {
      this.running = false;
      clearInterval(this.timer);
      if (this.segment && this.segment.rec.state !== 'inactive') this.segment.rec.stop();
      if (this.ctx) this.ctx.close();
    }
  }

  // ---------- Démarrage / arrêt ----------

  let engine = null;
  let mediaStream = null;
  let wakeLock = null;

  async function getAudioStream(source) {
    if (source === 'mic') {
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Le partage d\'onglet n\'est pas disponible sur cet appareil (utilisez un ordinateur avec Chrome ou Edge).');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Aucun son partagé : recommencez et cochez « Partager l\'audio ».');
    }
    return stream;
  }

  async function start() {
    saveSettings();
    const source = $('source').value;
    const engineName = $('engine').value;
    const lang = $('srcLang').value;
    $('startBtn').disabled = true;

    try {
      if (engineName === 'browser' && !SpeechRecognition) {
        throw new Error('Reconnaissance vocale indisponible dans ce navigateur. Utilisez Chrome/Edge ou le moteur Whisper.');
      }
      if (engineName === 'whisper' && !$('apiKey').value.trim()) {
        $('whisperSettings').open = true;
        throw new Error('Entrez une clé API pour le moteur Whisper.');
      }

      setStatus('Préparation de la traduction…');
      const provider = await translator.configure($('translator').value, lang, $('tgtLang').value, (p) => {
        setStatus(`Téléchargement du modèle de traduction… ${Math.round(p * 100)} %`);
      });

      // Le moteur du navigateur gère lui-même le micro ; sinon on capture le flux audio.
      if (engineName === 'whisper' || source === 'tab') {
        setStatus('Choix de la source audio…');
        mediaStream = await getAudioStream(source);
      }

      const handlers = {
        onInterim,
        onFinal,
        onWarning: (msg) => console.warn(msg),
        onFatal: (msg) => { stop(); setStatus(msg, 'error'); },
      };

      if (engineName === 'browser') {
        engine = new BrowserEngine({ lang, track: mediaStream ? mediaStream.getAudioTracks()[0] : null }, handlers);
      } else {
        engine = new WhisperEngine({
          stream: mediaStream,
          lang,
          apiBase: $('apiBase').value.trim() || 'https://api.openai.com/v1',
          apiKey: $('apiKey').value.trim(),
          model: $('apiModel').value.trim() || 'gpt-4o-mini-transcribe',
        }, handlers);
      }
      engine.start();

      try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* facultatif */ }

      const providerNames = { builtin: 'Chrome hors ligne', google: 'Google', mymemory: 'MyMemory' };
      setStatus(`Écoute en cours — traduction : ${providerNames[provider]}`, 'listening');
      showLive('', '', false);
      $('stopBtn').disabled = false;
    } catch (err) {
      stop();
      const msg = err.name === 'NotAllowedError' ? 'Autorisation refusée (micro ou partage d\'écran).' : err.message;
      setStatus(msg, 'error');
    }
  }

  function stop() {
    if (engine) engine.stop();
    engine = null;
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    clearTimeout(interimTimer);
    interimTimer = null;
    if ('speechSynthesis' in self) speechSynthesis.cancel();
    $('startBtn').disabled = false;
    $('stopBtn').disabled = true;
    setStatus('Arrêté');
  }

  // ---------- Sous-titres flottants (Document Picture-in-Picture) ----------

  let pipWindow = null;

  async function togglePip() {
    if (pipWindow) { pipWindow.close(); return; }
    if (!('documentPictureInPicture' in self)) {
      alert('Les sous-titres flottants nécessitent Chrome ou Edge (version 116+) sur ordinateur. '
        + 'Astuce : sinon, placez cette fenêtre à côté de la réunion.');
      return;
    }
    const stage = $('stage');
    const placeholder = document.createComment('stage');
    pipWindow = await documentPictureInPicture.requestWindow({ width: 640, height: 200 });
    for (const sheet of document.styleSheets) {
      try {
        const style = pipWindow.document.createElement('style');
        style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
        pipWindow.document.head.append(style);
      } catch { /* feuille inaccessible */ }
    }
    pipWindow.document.title = 'Sous-titres';
    pipWindow.document.body.className = 'pip';
    stage.replaceWith(placeholder);
    pipWindow.document.body.append(stage);
    applyDisplaySettings();
    pipWindow.addEventListener('pagehide', () => {
      placeholder.replaceWith(stage);
      pipWindow = null;
    });
  }

  // ---------- Export ----------

  function exportTranscript() {
    const lines = [...$('history').children].map((li) => {
      const time = li.querySelector('time').textContent;
      return `[${time}]\n${li.querySelector('.tr').textContent}\n(${li.querySelector('.src').textContent})\n`;
    });
    if (!lines.length) { alert('Rien à exporter pour le moment.'); return; }
    const blob = new Blob([`Traduction du ${new Date().toLocaleString('fr-FR')}\n\n${lines.join('\n')}`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `traduction-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Initialisation ----------

  loadSettings();
  applyDisplaySettings();
  for (const id of SETTING_FIELDS) {
    $(id).addEventListener('change', () => { saveSettings(); applyDisplaySettings(); });
  }
  $('fontSize').addEventListener('input', applyDisplaySettings);
  $('startBtn').addEventListener('click', start);
  $('stopBtn').addEventListener('click', stop);
  $('pipBtn').addEventListener('click', togglePip);
  $('fullBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('stage').requestFullscreen().catch(() => {});
  });
  $('exportBtn').addEventListener('click', exportTranscript);
  $('clearBtn').addEventListener('click', () => {
    $('history').replaceChildren();
    lastFinal = { original: '', translation: '' };
    showLive('La traduction apparaîtra ici…', '', false);
  });
  if ('speechSynthesis' in self) speechSynthesis.getVoices(); // précharge les voix

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
