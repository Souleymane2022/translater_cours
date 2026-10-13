// Traducteur de Cours — reconnaissance vocale + traduction en temps réel.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SpeechRecognition = self.SpeechRecognition || self.webkitSpeechRecognition;

  const SETTINGS_KEY = 'traducteur-cours-settings';
  const SETTING_FIELDS = ['source', 'engine', 'srcLang', 'tgtLang', 'translator', 'apiBase', 'apiModel', 'apiKey', 'geminiKey', 'geminiModel', 'speak', 'showOriginal', 'fontSize'];

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
    if (!$('geminiModel').value) $('geminiModel').value = 'gemini-3.5-flash-lite';
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
    $('geminiSettings').open = $('engine').value === 'gemini';
    $('translator').disabled = $('engine').value === 'gemini';
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
    if (engine === 'browser' && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      hints.push('📱 Sur téléphone, la reconnaissance du navigateur est souvent peu fiable : le moteur Gemini est bien plus précis.');
    }
    if (engine === 'gemini') {
      hints.push('Gemini écoute par phrases : la traduction arrive 2 à 4 secondes après chaque pause de l\'orateur.');
    }
    if ($('speak').checked) hints.push('🎧 Avec la lecture à voix haute, utilisez des écouteurs pour que le micro ne capte pas la voix française.');
    $('sourceHint').textContent = hints.join(' ');
  }

  // ---------- Affichage ----------

  // Les erreurs s'affichent dans un bandeau lisible ; la pastille d'état reste courte.
  function setStatus(text, kind) {
    const el = $('status');
    const alertBox = $('alert');
    el.className = `status${kind ? ` ${kind}` : ''}`;
    if (kind === 'error') {
      el.textContent = 'Erreur';
      alertBox.textContent = `⚠️ ${text}`;
      alertBox.hidden = false;
    } else {
      el.textContent = text;
      alertBox.hidden = true;
    }
  }

  let warningTimer = null;
  function showWarning(msg) {
    const alertBox = $('alert');
    alertBox.textContent = `⚠️ ${msg}`;
    alertBox.hidden = false;
    clearTimeout(warningTimer);
    warningTimer = setTimeout(() => { if (engine) alertBox.hidden = true; }, 6000);
  }

  // Sur téléphone/tablette, le partage d'onglet et les sous-titres flottants n'existent pas : on les masque.
  function adaptToDevice() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) {
      const tab = $('source').querySelector('option[value="tab"]');
      tab.disabled = true;
      tab.textContent = '🖥️ Audio d\'un onglet (sur ordinateur uniquement)';
      $('source').value = 'mic';
    }
    if (!('documentPictureInPicture' in self)) $('pipBtn').hidden = true;
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

  function onInterim(text, { translate = true } = {}) {
    latestInterim = text;
    showLive(lastFinal.translation, text, true);
    if (!translate || interimTimer) return;
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

  function onFinal(text, translation) {
    text = text.trim();
    if (!text) return;
    latestInterim = '';
    if (interimAbort) interimAbort.abort();
    const item = addHistoryItem(text);
    const pending = translation ? Promise.resolve(translation) : translator.translate(text);
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

  // ---------- Moteurs 2 et 3 : envoi de segments audio à une API (Whisper, Gemini) ----------

  // Petit processeur audio qui renvoie le son brut (PCM) au fil de l'eau.
  const PCM_WORKLET = `
    class PcmTap extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) {
          for (let i = 0; i < ch.length; i++) {
            this.buf[this.n++] = ch[i];
            if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
          }
        }
        return true;
      }
    }
    registerProcessor('pcm-tap', PcmTap);`;

  const WAV_RATE = 16000;

  // Convertit le son en WAV mono 16 kHz : format accepté par Whisper et Gemini sur tous les navigateurs.
  function encodeWav(samples, inputRate) {
    const ratio = inputRate / WAV_RATE;
    const length = Math.floor(samples.length / ratio);
    const view = new DataView(new ArrayBuffer(44 + length * 2));
    const writeStr = (o, str) => { for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, WAV_RATE, true); view.setUint32(28, WAV_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeStr(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      // Moyenne des échantillons d'origine couverts : rééchantillonnage simple et anti-repliement léger.
      const from = Math.floor(i * ratio);
      const to = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += samples[j];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
      view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // Découpe le flux audio aux pauses de l'orateur et envoie chaque segment à transcribe().
  class SegmentedEngine {
    constructor({ stream, lang }, handlers, { minMs = 2000, maxMs = 14000 } = {}) {
      this.stream = new MediaStream(stream.getAudioTracks());
      this.lang = lang;
      this.handlers = handlers;
      this.minMs = minMs;
      this.maxMs = maxMs;
      this.running = false;
      this.chain = Promise.resolve();
    }

    async start() {
      this.running = true;
      this.ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = this.ctx.createMediaStreamSource(this.stream);
      const tap = new AudioWorkletNode(this.ctx, 'pcm-tap');
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      source.connect(tap).connect(mute).connect(this.ctx.destination);
      tap.port.onmessage = (e) => this.onFrames(e.data);
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.newSegment();
      this.stream.getAudioTracks()[0].addEventListener('ended', () => {
        if (this.running) this.handlers.onFatal('Le partage audio a été arrêté.');
      });
    }

    newSegment() {
      this.segment = { frames: [], durationMs: 0, speechMs: 0, silenceMs: 0 };
    }

    onFrames(frame) {
      if (!this.running) return;
      const seg = this.segment;
      const frameMs = (frame.length / this.ctx.sampleRate) * 1000;
      let sum = 0;
      for (const v of frame) sum += v * v;
      const rms = Math.sqrt(sum / frame.length);
      seg.frames.push(frame);
      seg.durationMs += frameMs;
      if (rms > 0.01) { seg.speechMs += frameMs; seg.silenceMs = 0; } else { seg.silenceMs += frameMs; }

      const pauseAfterSpeech = seg.speechMs >= 400 && seg.silenceMs >= 600 && seg.durationMs >= this.minMs;
      if (pauseAfterSpeech || seg.durationMs >= this.maxMs) {
        this.newSegment();
        if (seg.speechMs >= 400) this.enqueue(seg); // rien d'audible : inutile d'envoyer
      }
      this.handlers.onInterim(seg.speechMs > 0 && seg.silenceMs < 600 ? '🎙️ …' : '', { translate: false });
    }

    enqueue(seg) {
      const samples = new Float32Array(seg.frames.reduce((n, f) => n + f.length, 0));
      let offset = 0;
      for (const f of seg.frames) { samples.set(f, offset); offset += f.length; }
      const request = this.transcribe(encodeWav(samples, this.ctx.sampleRate));
      this.chain = this.chain.then(async () => {
        try {
          const result = await request;
          const { original = '', translation } = typeof result === 'string' ? { original: result } : result;
          const text = original.trim();
          if (text && !WHISPER_HALLUCINATIONS.test(text)) this.handlers.onFinal(text, translation);
        } catch (err) {
          if (/HTTP (400|401|403|404)/.test(err.message)) this.handlers.onFatal(this.explainError(err));
          else this.handlers.onWarning(this.explainError(err));
        }
      });
    }

    explainError(err) {
      if (/HTTP 429/.test(err.message)) return 'Trop de requêtes (quota gratuit atteint) : quelques phrases peuvent manquer.';
      if (/HTTP (401|403)/.test(err.message)) return `Clé API refusée. Vérifiez la clé. (${err.message})`;
      if (/HTTP 404/.test(err.message)) return `Modèle introuvable : vérifiez son nom. (${err.message})`;
      return err.message;
    }

    stop() {
      this.running = false;
      if (this.ctx) this.ctx.close();
    }
  }

  class WhisperEngine extends SegmentedEngine {
    constructor({ apiBase, apiKey, model, ...rest }, handlers) {
      super(rest, handlers);
      this.apiBase = apiBase.replace(/\/+$/, '');
      this.apiKey = apiKey;
      this.model = model;
    }

    async transcribe(blob) {
      const form = new FormData();
      form.append('file', blob, 'segment.wav');
      form.append('model', this.model);
      form.append('language', this.lang.split('-')[0]);
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
  }

  // Gemini écoute l'audio et renvoie en une seule requête la transcription ET la traduction.
  class GeminiEngine extends SegmentedEngine {
    constructor({ apiKey, model, srcName, tgtName, ...rest }, handlers) {
      // Segments plus longs : moins de requêtes (quota gratuit) et plus de contexte pour traduire.
      super(rest, handlers, { minMs: 4000, maxMs: 15000 });
      this.apiKey = apiKey;
      this.model = model;
      this.srcName = srcName;
      this.tgtName = tgtName;
      this.context = [];
    }

    async transcribe(blob) {
      const previous = this.context.join(' ');
      const prompt = `You are a professional live interpreter for a lecture or meeting. `
        + `The audio is the next short excerpt of speech in ${this.srcName}. `
        + `1) Transcribe exactly what is said. 2) Translate it into natural, fluent ${this.tgtName}, `
        + `keeping technical terms accurate. `
        + (previous ? `For context only (already translated, do not repeat it): "${previous}". ` : '')
        + `If the audio contains no intelligible speech, return empty strings.`;
      const body = {
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'audio/wav', data: await blobToBase64(blob) } },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { original: { type: 'STRING' }, translation: { type: 'STRING' } },
            required: ['original', 'translation'],
          },
        },
      };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify(body) },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}${data.error ? ` — ${data.error.message}` : ''}`);
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      let result;
      try { result = JSON.parse(text); } catch { return { original: '', translation: '' }; }
      if (result.original) {
        this.context.push(result.original);
        if (this.context.length > 3) this.context.shift();
      }
      return result;
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
      if (engineName === 'gemini' && !$('geminiKey').value.trim()) {
        $('geminiSettings').open = true;
        throw new Error('Entrez votre clé API Gemini (gratuite sur aistudio.google.com/apikey).');
      }

      let provider = 'gemini';
      if (engineName !== 'gemini') {
        setStatus('Préparation de la traduction…');
        provider = await translator.configure($('translator').value, lang, $('tgtLang').value, (p) => {
          setStatus(`Téléchargement du modèle de traduction… ${Math.round(p * 100)} %`);
        });
      }

      // Le moteur du navigateur gère lui-même le micro ; sinon on capture le flux audio.
      if (engineName !== 'browser' || source === 'tab') {
        setStatus('Choix de la source audio…');
        mediaStream = await getAudioStream(source);
      }

      const handlers = {
        onInterim,
        onFinal,
        onWarning: (msg) => { console.warn(msg); showWarning(msg); },
        onFatal: (msg) => { stop(); setStatus(msg, 'error'); },
      };

      if (engineName === 'browser') {
        engine = new BrowserEngine({ lang, track: mediaStream ? mediaStream.getAudioTracks()[0] : null }, handlers);
      } else if (engineName === 'gemini') {
        const optionText = (id) => $(id).selectedOptions[0].textContent;
        engine = new GeminiEngine({
          stream: mediaStream,
          lang,
          apiKey: $('geminiKey').value.trim(),
          model: $('geminiModel').value.trim() || 'gemini-3.5-flash-lite',
          srcName: optionText('srcLang'),
          tgtName: optionText('tgtLang'),
        }, handlers);
      } else {
        engine = new WhisperEngine({
          stream: mediaStream,
          lang,
          apiBase: $('apiBase').value.trim() || 'https://api.openai.com/v1',
          apiKey: $('apiKey').value.trim(),
          model: $('apiModel').value.trim() || 'gpt-4o-mini-transcribe',
        }, handlers);
      }
      await engine.start();

      try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* facultatif */ }

      const providerNames = { gemini: 'Gemini', builtin: 'Chrome hors ligne', google: 'Google', mymemory: 'MyMemory' };
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
  adaptToDevice();
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
