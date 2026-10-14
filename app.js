// Traducteur de Cours — reconnaissance vocale + traduction en temps réel.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SpeechRecognition = self.SpeechRecognition || self.webkitSpeechRecognition;

  const SETTINGS_KEY = 'traducteur-cours-settings';
  // Version 2 : Gemini Live devient le moteur conseillé ; les anciens choix « Gemini » y sont basculés une fois.
  const SETTINGS_VERSION = 2;
  const SETTING_FIELDS = ['source', 'engine', 'srcLang', 'tgtLang', 'translator', 'apiBase', 'apiModel', 'apiKey', 'geminiKey', 'geminiModel', 'liveModel', 'speak', 'duck', 'autoPause', 'ytUrl', 'showOriginal', 'fontSize'];

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
    if ((saved.version || 1) < 2 && saved.engine === 'gemini') $('engine').value = 'live';
    if (!$('apiBase').value) $('apiBase').value = 'https://api.openai.com/v1';
    if (!$('apiModel').value) $('apiModel').value = 'gpt-4o-mini-transcribe';
    if (!$('liveModel').value) $('liveModel').value = 'gemini-3.5-live-translate-preview';
    if (!$('geminiModel').value || $('geminiModel').value === 'gemini-3.5-flash-lite') $('geminiModel').value = 'gemini-3.1-flash-lite';
  }

  function saveSettings() {
    const data = { version: SETTINGS_VERSION };
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
    $('playerCard').hidden = $('source').value !== 'file';
    // Gemini Live reconnaît tout seul la langue parlée : un choix de moins.
    $('srcLangLabel').hidden = $('engine').value === 'live';
    $('onboarding').hidden = !(['live', 'gemini'].includes($('engine').value) && !$('geminiKey').value.trim());
    $('ytCard').hidden = $('source').value !== 'youtube';
    const usesGemini = ['gemini', 'live'].includes($('engine').value);
    $('geminiSettings').open = usesGemini;
    $('translator').disabled = usesGemini;
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
    } else if (source === 'speaker') {
      hints.push('📱 Réunion sur ce téléphone : 1) appuyez sur Démarrer ici, 2) activez « Sous-titres flottants », '
        + '3) ouvrez Zoom, Meet ou WhatsApp et mettez le son en haut-parleur. La traduction reste affichée au-dessus de la réunion. '
        + 'Certains téléphones coupent le micro des autres applications pendant un appel : dans ce cas, utilisez un 2ᵉ appareil '
        + 'posé à côté, ou rejoignez la réunion depuis un ordinateur. '
        + '🔊 Pendant que la voix de la traduction parle, l\'écoute fait une courte pause pour ne pas la retraduire. '
        + 'Le volume de Zoom, YouTube ou WhatsApp ne peut pas être baissé par le site : baissez-le un peu vous-même.');
    } else if (source === 'youtube') {
      hints.push('▶️ Collez le lien de la vidéo YouTube, appuyez sur « Charger », puis sur Démarrer. La vidéo est lue ici : '
        + 'son volume baisse pendant la voix de la traduction, et la pause est suivie. Le son est capté par le micro : '
        + 'gardez le haut-parleur (pas d\'écouteurs). Cochez « Mettre la vidéo en pause pendant la voix » pour ne rien manquer.');
    } else if (source === 'file') {
      hints.push('Choisissez un cours enregistré, une vidéo téléchargée ou un message vocal : il est traduit pendant la lecture. '
        + 'Astuce Android : dans WhatsApp ou la galerie, « Partager » → « Traducteur de Cours » (application installée).');
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
      hints.push('📱 Sur téléphone, la reconnaissance du navigateur est souvent peu fiable : le moteur Gemini Live est bien plus précis.');
    }
    if (engine === 'live') {
      hints.push('⚡ Traduction simultanée : la traduction s\'écrit pendant que l\'orateur parle. '
        + 'Cochez « Lire la traduction à voix haute » pour entendre une voix d\'interprète.');
    }
    if (engine === 'gemini') {
      hints.push('Gemini écoute par phrases : la traduction arrive 2 à 4 secondes après chaque pause de l\'orateur.');
    }
    if (speakEnabled() && $('source').value !== 'speaker') hints.push('🎧 Avec la lecture à voix haute, utilisez des écouteurs pour que le micro ne capte pas la voix française.');
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
    if (!('documentPictureInPicture' in self) && !videoPipSupported()) $('pipBtn').hidden = true;
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
    videoPip.text = [tr.textContent, src.textContent];
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
    tr.dir = 'auto';
    tr.textContent = '…';
    const src = document.createElement('div');
    src.className = 'src';
    src.dir = 'auto';
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

  function speakEnabled() {
    return $('speak').checked;
  }

  // Sources dont l'application contrôle la lecture (volume, pause).
  const controlledSource = () => ['file', 'youtube'].includes($('source').value);

  // Anti-écho en mode « Réunion sur ce téléphone » : le micro, sans annulation d'écho, entend aussi la voix
  // de la traduction. Gemini Live la reconnaît (déjà dans la langue cible) et l'ignore ; pour les autres
  // moteurs, l'écoute est mise en pause pendant que la voix parle, pour ne pas la retraduire en boucle.
  let echoGuard = false;
  let voiceQuietUntil = 0;
  function muteForVoice() {
    return echoGuard && (('speechSynthesis' in self && speechSynthesis.speaking) || Date.now() < voiceQuietUntil);
  }

  function speak(text) {
    if (!speakEnabled() || !('speechSynthesis' in self) || !text) return;
    // Aucune phrase n'est abandonnée : si des phrases attendent, la voix parle un peu plus vite.
    const lang = $('tgtLang').value;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = pendingUtterances >= 2 ? 1.3 : pendingUtterances === 1 ? 1.2 : 1.1;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
    if (voice) u.voice = voice;
    pendingUtterances++;
    u.onend = u.onerror = () => {
      pendingUtterances = Math.max(0, pendingUtterances - 1);
      voiceQuietUntil = Date.now() + 700; // la fin de la voix résonne encore un peu
    };
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

  // Dernières phrases reçues : une phrase identique reçue à nouveau dans les 30 s est ignorée
  // (reprise de session, reconnaissance Android qui renvoie tout le texte, écho…).
  const recentFinals = [];
  const normalize = (t) => (t || '').toLowerCase().replace(/[\s.,;:!?¿¡…'"«»“”-]+/g, ' ').trim();

  function isRepeat(text, translation) {
    const key = normalize(translation || text);
    const now = Date.now();
    while (recentFinals.length && now - recentFinals[0].at > 30000) recentFinals.shift();
    if (key && recentFinals.some((f) => f.key === key)) return true;
    recentFinals.push({ key, at: now });
    if (recentFinals.length > 5) recentFinals.shift();
    return false;
  }

  function onFinal(text, translation, { spoken = false } = {}) {
    text = text.trim();
    if (!text || isRepeat(text, translation)) return;
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
        if (!spoken) speak(tr);
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

      this.lastFinal = '';
      this.rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) this.final(r[0].transcript);
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
        this.lastFinal = '';
        setTimeout(() => this.running && this.launch(), 250);
      };

      this.launch();
    }

    // Sur Android, Chrome renvoie parfois tout le texte déjà reconnu à chaque nouvelle phrase :
    // on ne garde que la partie nouvelle.
    final(transcript) {
      if (muteForVoice()) return; // c'est la voix de la traduction qui a été entendue
      const text = transcript.trim();
      const previous = this.lastFinal;
      this.lastFinal = text;
      if (!text || text === previous) return;
      const fresh = previous && text.toLowerCase().startsWith(previous.toLowerCase()) ? text.slice(previous.length).trim() : text;
      if (fresh) this.handlers.onFinal(fresh);
    }

    launch() {
      try {
        if (this.track) this.rec.start(this.track);
        else this.rec.start();
      } catch (err) {
        if (err.name !== 'InvalidStateError') this.handlers.onFatal(err.message);
      }
    }

    // Fin d'un fichier : on laisse la reconnaissance rendre ses derniers mots.
    finish() {
      return new Promise((r) => setTimeout(r, 1500));
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
      this.ctx = watchContext(new AudioContext());
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
      if (muteForVoice()) frame = new Float32Array(frame.length); // ne pas réentendre la voix de la traduction
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
          if (/^HTTP (401|403|404)/.test(err.message)) this.handlers.onFatal(this.explainError(err));
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

    pauseInput() {
      const seg = this.segment;
      this.newSegment();
      if (seg && seg.speechMs >= 400) this.enqueue(seg);
    }

    resumeInput() {}

    // Fin d'un fichier : on envoie le segment en cours et on attend toutes les réponses.
    async finish() {
      const seg = this.segment;
      this.newSegment();
      if (seg && seg.speechMs >= 400) this.enqueue(seg);
      await this.chain;
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

  // Modèles essayés si celui choisi est surchargé (503), trop lent, épuisé (429) ou retiré (404).
  const GEMINI_FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'];
  const GEMINI_TIMEOUT_MS = 12000;

  // Gemini écoute l'audio et renvoie en une seule requête la transcription ET la traduction.
  class GeminiEngine extends SegmentedEngine {
    constructor({ apiKey, model, srcName, tgtName, ...rest }, handlers) {
      // Segments plus longs : moins de requêtes (quota gratuit) et plus de contexte pour traduire.
      super(rest, handlers, { minMs: 4000, maxMs: 15000 });
      this.apiKey = apiKey;
      this.models = [...new Set([model, ...GEMINI_FALLBACKS])];
      this.noThinkingConfig = new Set(); // modèles qui refusent le réglage de réflexion
      this.srcName = srcName;
      this.tgtName = tgtName;
      this.context = [];
    }

    buildBody(base64, withThinking) {
      const previous = this.context.join(' ');
      const prompt = `You are a professional live interpreter for a lecture or meeting. `
        + `The audio is the next short excerpt of speech in ${this.srcName}. `
        + `1) Transcribe exactly what is said. 2) Translate it into natural, fluent ${this.tgtName}, `
        + `keeping technical terms accurate. `
        + (previous ? `For context only (already translated, do not repeat it): "${previous}". ` : '')
        + `If the audio contains no intelligible speech, return empty strings.`;
      const generationConfig = {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { original: { type: 'STRING' }, translation: { type: 'STRING' } },
          required: ['original', 'translation'],
        },
      };
      // Pas de « réflexion » : la réponse arrive bien plus vite.
      if (withThinking) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
      return JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }, { inline_data: { mime_type: 'audio/wav', data: base64 } }],
        }],
        generationConfig,
      });
    }

    async callModel(model, base64) {
      const withThinking = !this.noThinkingConfig.has(model);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), GEMINI_TIMEOUT_MS);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: this.buildBody(base64, withThinking),
            signal: abort.signal,
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = (data.error && data.error.message) || '';
          if (res.status === 400 && withThinking && /thinking/i.test(message)) {
            this.noThinkingConfig.add(model);
            return this.callModel(model, base64);
          }
          throw new Error(`HTTP ${res.status}${message ? ` — ${message}` : ''}`);
        }
        const candidate = data.candidates && data.candidates[0];
        const parts = (candidate && candidate.content && candidate.content.parts) || [];
        return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('délai dépassé');
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    async transcribe(blob) {
      const base64 = await blobToBase64(blob);
      let lastErr;
      for (const model of [...this.models]) {
        try {
          const text = await this.callModel(model, base64);
          // On garde en tête de liste le modèle qui vient de répondre.
          this.models = [model, ...this.models.filter((m) => m !== model)];
          let result;
          try { result = JSON.parse(text); } catch { result = { original: '', translation: '' }; }
          if (result.original) {
            this.context.push(result.original);
            if (this.context.length > 3) this.context.shift();
          }
          return result;
        } catch (err) {
          if (/HTTP (401|403)/.test(err.message)) throw err;
          if (/HTTP 404/.test(err.message)) this.models = this.models.filter((m) => m !== model);
          lastErr = err;
          console.warn(`Gemini « ${model} » : ${err.message}`);
        }
      }
      throw new Error(`Gemini indisponible pour cette phrase (${lastErr ? lastErr.message : 'aucun modèle'}). Réessai à la phrase suivante.`);
    }
  }

  // ---------- Moteur 4 : Gemini Live — traduction simultanée en continu ----------

  const LIVE_INPUT_RATE = 16000;
  const LIVE_OUTPUT_RATE = 24000;
  const LIVE_FROZEN_MS = 12000; // parole entendue sans aucune réponse avant de changer de session
  const LIVE_SILENCE_MS = 1500; // au-delà, on n'envoie plus le silence (vidéo en pause…)
  const ECHO_WINDOW_MS = 120000; // une traduction qui ressemble à celles des 2 dernières minutes est un écho
  const ECHO_HOLD_WORDS = 6; // mots attendus avant de jouer la voix d'un nouveau tour (mode haut-parleur)
  const VOICE_RMS = 0.004; // en dessous, un morceau de voix reçu est du silence
  const VOICE_CATCHUP_S = 0.4; // retard au-delà duquel les silences en attente sont retirés
  const MAX_MUTE_MS = 8000; // le micro n'est jamais coupé plus longtemps d'affilée (anti-écho)
  const SENTENCE_FLUSH_CHARS = 60; // une phrase terminée de cette longueur part dans l'historique
  const IDLE_FLUSH_MS = 2500; // sans nouveau texte pendant ce temps, la phrase en cours part dans l'historique

  const wordsOf = (t) => (t || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

  // Vrai si `text` reprend une traduction récente : mêmes 6 premiers mots (ou plus) à la suite, ou presque
  // tous les mêmes mots. Les phrases courtes ne sont comparées qu'à l'identique, pour ne pas jeter
  // une vraie phrase qui commence comme une autre (« Aujourd'hui, nous allons… »).
  function looksLikeEcho(text, recent) {
    const words = wordsOf(text);
    if (!words.length) return false;
    const joined = words.join(' ');
    const prefix = words.slice(0, 8).join(' ');
    return recent.some((r) => {
      const rw = wordsOf(r);
      if (rw.join(' ') === joined) return true;
      if (words.length >= ECHO_HOLD_WORDS && ` ${rw.join(' ')} `.includes(` ${prefix} `)) return true;
      const set = new Set(rw);
      return words.length >= 5 && words.filter((w) => set.has(w)).length / words.length >= 0.85;
    });
  }

  // Rééchantillonne le flux du micro vers 16 kHz, en gardant l'état d'un bloc à l'autre.
  class Resampler {
    constructor(inputRate, outputRate) {
      this.step = inputRate / outputRate;
      this.pos = 0;
    }

    push(input) {
      const out = new Int16Array(Math.ceil((input.length - this.pos) / this.step));
      let n = 0;
      for (; this.pos < input.length; this.pos += this.step) {
        const i = Math.floor(this.pos);
        const frac = this.pos - i;
        const a = input[i];
        const b = i + 1 < input.length ? input[i + 1] : input[i];
        const v = Math.max(-1, Math.min(1, a + (b - a) * frac));
        out[n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.pos -= input.length;
      return out.subarray(0, n);
    }
  }

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  class GeminiLiveEngine {
    constructor({ stream, apiKey, model, targetLang, playCtx }, handlers) {
      this.stream = new MediaStream(stream.getAudioTracks());
      this.apiKey = apiKey;
      this.model = model;
      this.targetLang = targetLang;
      // Contexte de lecture créé au moment du clic (sinon Android bloque le son).
      this.playCtx = playCtx;
      this.playAudio = !!playCtx;
      this.playAt = 0;
      this.voiceUntil = 0; // fin du dernier morceau de voix audible (horloge du contexte de lecture)
      this.mutedMs = 0; // durée pendant laquelle le micro est coupé d'affilée (anti-écho)
      this.handlers = handlers;
      this.running = false;
      this.ready = false;
      this.resumeHandle = null;
      this.pending = [];
      this.original = '';
      this.translation = '';
      this.recent = []; // traductions déjà données : { text, at }
      this.held = null; // voix d'un nouveau tour, retenue le temps de vérifier que ce n'est pas un écho
      this.dropTurn = false;
      this.silentMs = 0;
      this.echoGuard = false; // micro qui entend le haut-parleur (réglé par start())
    }

    pauseInput() { this.paused = true; }

    resumeInput() { this.paused = false; this.silentMs = 0; }

    // La voix de l'interprète est audible en ce moment (ou le sera dans l'instant). Gemini envoie aussi des
    // morceaux de silence : seuls les morceaux audibles comptent, sinon la « voix » ne s'arrêterait jamais.
    voicePlaying() {
      return !!this.playCtx && this.voiceUntil > 0 && this.playCtx.currentTime < this.voiceUntil + 0.3;
    }

    async start() {
      this.running = true;
      this.ctx = watchContext(new AudioContext());
      const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = this.ctx.createMediaStreamSource(this.stream);
      const tap = new AudioWorkletNode(this.ctx, 'pcm-tap');
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      source.connect(tap).connect(mute).connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.resampler = new Resampler(this.ctx.sampleRate, LIVE_INPUT_RATE);
      tap.port.onmessage = (e) => this.onFrames(e.data);
      this.stream.getAudioTracks()[0].addEventListener('ended', () => {
        if (this.running) this.handlers.onFatal('Le partage audio a été arrêté.');
      });
      try {
        await this.connect();
      } catch (err) {
        if (this.isPermanent(err.message)) throw err;
        this.reconnect(); // coupure passagère : l'écoute démarre et la connexion se rétablit seule
      }
    }

    connect() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/'
          + 'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
          + `?key=${encodeURIComponent(this.apiKey)}`);
        ws.binaryType = 'arraybuffer';
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; ws.close(); reject(new Error('Gemini Live ne répond pas (délai dépassé).')); }
        }, 15000);

        ws.onopen = () => ws.send(JSON.stringify({ setup: this.setupMessage() }));
        ws.onmessage = (e) => {
          let msg;
          try { msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)); } catch { return; }
          if (msg.setupComplete) {
            if (this.ws && this.ws !== ws) this.ws.close();
            this.ws = ws;
            this.ready = true;
            clearTimeout(timer);
            if (!settled) { settled = true; resolve(); }
            return;
          }
          this.onMessage(msg);
        };
        ws.onclose = (e) => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            reject(new Error(this.explainClose(e)));
            return;
          }
          if (ws !== this.ws || !this.running) return;
          this.ready = false;
          // Clé ou modèle refusés : inutile d'insister. Toute autre coupure (fin de session, réseau,
          // quota par minute, erreur passagère du serveur) : on se reconnecte.
          if (this.isPermanent(e.reason)) {
            this.handlers.onFatal(this.explainClose(e));
            return;
          }
          this.reconnect();
        };
      });
    }

    reconnect(delay = 500) {
      if (this.reconnecting || !this.running) return;
      this.reconnecting = true;
      this.handlers.onReconnecting(true);
      setTimeout(async () => {
        if (!this.running) { this.reconnecting = false; return; }
        try {
          await this.connect();
        } catch (err) {
          this.reconnecting = false;
          if (this.isPermanent(err.message)) { this.handlers.onFatal(err.message); return; }
          // La session n'a pas pu être reprise (expirée après une longue écoute) : on en ouvre une nouvelle.
          this.resumeHandle = null;
          return this.reconnect(Math.min(delay * 2, 8000));
        }
        this.reconnecting = false;
        this.handlers.onReconnecting(false);
      }, delay);
    }

    // Erreurs définitives : clé refusée, modèle inconnu. « Session not found » (reprise impossible) n'en est
    // pas une : on ouvre simplement une nouvelle session.
    isPermanent(reason) {
      const r = reason || '';
      return /api key|API_KEY|permission|unauth|Clé API|Modèle Live/i.test(r)
        || /model[^]*?(not found|not supported)|(not found|not supported)[^]*?model/i.test(r);
    }

    explainClose(e) {
      const reason = e.reason || `code ${e.code}`;
      if (/api key|API_KEY|permission|unauth/i.test(reason)) return `Clé API Gemini refusée. (${reason})`;
      if (/model[^]*?(not found|not supported)|(not found|not supported)[^]*?model/i.test(reason)) return `Modèle Live introuvable : vérifiez son nom. (${reason})`;
      if (/quota|exhausted|rate/i.test(reason)) return `Quota Gemini atteint. (${reason})`;
      return `Connexion Gemini Live fermée. (${reason})`;
    }

    setupMessage() {
      return {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          translationConfig: {
            targetLanguageCode: this.targetLang,
            // Ne pas répéter ce qui est déjà en français (évite aussi de retraduire la voix lue à voix haute).
            echoTargetLanguage: false,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
        sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
      };
    }

    onFrames(frame) {
      if (!this.running) return;
      // Micro qui entend le haut-parleur : pendant que l'interprète parle, on n'écoute pas (sinon il se retraduit).
      // Sécurité : jamais plus de 8 s d'affilée, pour qu'un incident ne fige pas la traduction.
      const frameMs = (frame.length / this.ctx.sampleRate) * 1000;
      if (this.echoGuard && this.voicePlaying() && this.mutedMs < MAX_MUTE_MS) {
        this.mutedMs += frameMs;
        frame = new Float32Array(frame.length);
      } else if (!this.voicePlaying()) {
        this.mutedMs = 0;
      }
      this.watchdog(frame);
      let sum = 0;
      for (const v of frame) sum += v * v;
      if (Math.sqrt(sum / frame.length) > 0.01) this.silentMs = 0;
      else this.silentMs += (frame.length / this.ctx.sampleRate) * 1000;
      this.pending.push(this.resampler.push(frame));
      const total = this.pending.reduce((n, a) => n + a.length, 0);
      if (total < LIVE_INPUT_RATE / 10) return; // envoi toutes les ~100 ms
      const pcm = new Int16Array(total);
      let offset = 0;
      for (const a of this.pending) { pcm.set(a, offset); offset += a.length; }
      this.pending = [];
      if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // Vidéo en pause ou silence de plus de 1,5 s : on n'envoie plus rien et on prévient Gemini
      // (audioStreamEnd), comme le demande l'API ; l'envoi reprend dès que le son revient.
      if (this.paused || this.silentMs > LIVE_SILENCE_MS) {
        if (!this.streamEnded) {
          this.streamEnded = true;
          this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        }
        return;
      }
      this.streamEnded = false;
      this.ws.send(JSON.stringify({
        realtimeInput: {
          audio: { mimeType: `audio/pcm;rate=${LIVE_INPUT_RATE}`, data: bytesToBase64(new Uint8Array(pcm.buffer)) },
        },
      }));
    }

    // Gemini Live peut se figer sans erreur : s'il entend de la parole pendant 12 s sans rien renvoyer,
    // on abandonne cette session et on en ouvre une neuve (sans reprise, qui resterait figée).
    watchdog(frame) {
      if (!this.ready) { this.speechWithoutReply = 0; return; }
      let sum = 0;
      for (const v of frame) sum += v * v;
      if (Math.sqrt(sum / frame.length) > 0.01) this.speechWithoutReply = (this.speechWithoutReply || 0) + (frame.length / this.ctx.sampleRate) * 1000;
      if (this.speechWithoutReply > LIVE_FROZEN_MS) {
        this.speechWithoutReply = 0;
        this.resumeHandle = null;
        this.handlers.onWarning('Gemini ne répondait plus : nouvelle session ouverte.');
        if (this.ws) this.ws.close(4000, 'session figée');
      }
    }

    onMessage(msg) {
      this.lastMessageAt = performance.now();
      if (msg.sessionResumptionUpdate && msg.sessionResumptionUpdate.resumable && msg.sessionResumptionUpdate.newHandle) {
        this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
      }
      if (msg.goAway) this.reconnect(0); // le serveur va fermer : on ouvre la suite tout de suite

      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.inputTranscription || sc.outputTranscription || sc.modelTurn) this.speechWithoutReply = 0;
      if (sc.inputTranscription && sc.inputTranscription.text) this.original += sc.inputTranscription.text;
      if (sc.outputTranscription && sc.outputTranscription.text) this.translation += sc.outputTranscription.text;
      if (this.playAudio && sc.modelTurn && sc.modelTurn.parts) {
        for (const part of sc.modelTurn.parts) {
          if (!part.inlineData || !part.inlineData.data || this.dropTurn) continue;
          // Mode haut-parleur, début d'un tour : la voix attend les premiers mots, pour vérifier que ce
          // n'est pas l'écho d'une traduction déjà dite (le micro entend l'interprète).
          if (!this.echoGuard) this.play(part.inlineData.data);
          else if (this.held) this.held.push(part.inlineData.data);
          else if (wordsOf(this.translation).length < ECHO_HOLD_WORDS && !this.turnChecked) this.held = [part.inlineData.data];
          else this.play(part.inlineData.data);
        }
      }
      this.checkEcho(!!sc.turnComplete);

      if (sc.turnComplete) { this.flush(); return; }
      // Gemini ne termine pas toujours ses tours : chaque phrase finie part dans l'historique au fil de l'eau,
      // et la phrase en cours y part aussi après 2,5 s sans nouveau texte.
      const grew = this.translation.length !== this.lastTranslationLength;
      this.flushSentences();
      this.lastTranslationLength = this.translation.length;
      // Le délai ne repart que si du texte arrive (Gemini envoie aussi des morceaux de silence en continu).
      if (grew) {
        clearTimeout(this.idleTimer);
        if (this.translation.trim()) this.idleTimer = setTimeout(() => this.flush(), IDLE_FLUSH_MS);
      }
      if (!this.dropTurn && (this.translation || this.original)) this.handlers.onLive(this.translation, this.original);
    }

    flushSentences() {
      if (this.dropTurn) return;
      const m = this.translation.match(/^([^]*[.!?…؟。！？])\s+(\S[^]*)?$/);
      if (!m || m[1].trim().length < SENTENCE_FLUSH_CHARS) return;
      const rest = m[2] || '';
      this.translation = m[1];
      this.flush({ keepTurn: true });
      this.translation = rest;
    }

    // Dès que le tour a assez de mots (ou se termine), on décide : écho d'une traduction récente → jeté
    // en entier (texte et voix) ; sinon la voix retenue est jouée.
    checkEcho(turnComplete) {
      if (!this.echoGuard || this.turnChecked || this.dropTurn) return;
      if (wordsOf(this.translation).length < ECHO_HOLD_WORDS && !turnComplete) return;
      const now = Date.now();
      this.recent = this.recent.filter((r) => now - r.at < ECHO_WINDOW_MS);
      this.turnChecked = true;
      if (this.translation.trim() && looksLikeEcho(this.translation, this.recent.map((r) => r.text))) {
        this.dropTurn = true;
        this.held = null;
        return;
      }
      if (this.held) { for (const data of this.held) this.play(data); this.held = null; }
    }

    flush({ keepTurn = false } = {}) {
      clearTimeout(this.idleTimer);
      const original = this.original.trim();
      const translation = this.translation.trim();
      const now = Date.now();
      this.recent = this.recent.filter((r) => now - r.at < ECHO_WINDOW_MS);
      // Hors mode haut-parleur la voix est déjà jouée ; on évite seulement d'afficher un doublon.
      const dropped = this.dropTurn || (!this.echoGuard && looksLikeEcho(translation, this.recent.map((r) => r.text)));
      if (this.held && !dropped) { for (const data of this.held) this.play(data); }
      this.original = '';
      this.translation = '';
      this.held = null;
      if (!keepTurn) { this.dropTurn = false; this.turnChecked = false; }
      if (!translation || dropped) return;
      this.recent.push({ text: translation, at: Date.now() });
      this.handlers.onFinal(original || '—', translation, { spoken: this.playAudio });
    }

    // Joue un morceau de la voix de l'interprète. Gemini l'envoie par rafales, plus vite que le temps réel,
    // avec des morceaux de silence : la parole n'est jamais sautée ni superposée ; quand la voix prend du
    // retard, on retire les silences en attente et on accélère légèrement (15 % au plus) pour rattraper.
    play(base64) {
      const bin = atob(base64);
      const samples = new Float32Array(bin.length >> 1);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        samples[i] = v / 0x8000;
        sum += samples[i] * samples[i];
      }
      if (!samples.length) return;
      const audible = Math.sqrt(sum / samples.length) > VOICE_RMS;
      const now = this.playCtx.currentTime;
      if (this.playAt < now) this.playAt = now + 0.05;
      const backlog = this.playAt - now;
      // En retard : un silence en attente ne ferait qu'ajouter du retard.
      if (!audible && backlog > VOICE_CATCHUP_S) return;
      const buffer = this.playCtx.createBuffer(1, samples.length, LIVE_OUTPUT_RATE);
      buffer.copyToChannel(samples, 0);
      const src = this.playCtx.createBufferSource();
      src.buffer = buffer;
      const rate = audible && backlog > 4 ? 1.15 : audible && backlog > 2 ? 1.08 : 1;
      src.playbackRate.value = rate;
      src.connect(this.playCtx.destination);
      src.start(this.playAt);
      const duration = buffer.duration / rate;
      if (audible) this.voiceUntil = Math.max(this.voiceUntil, this.playAt + duration);
      this.playAt += duration;
    }

    // Fin d'un fichier : on attend que Gemini ait fini de traduire (2,5 s sans message, 20 s au plus).
    async finish() {
      const t0 = performance.now();
      this.lastMessageAt = this.lastMessageAt || t0;
      while (performance.now() - this.lastMessageAt < 2500 && performance.now() - t0 < 20000) {
        await new Promise((r) => setTimeout(r, 250));
      }
      this.flush();
    }

    stop() {
      this.running = false;
      this.ready = false;
      this.flush();
      if (this.ws) { this.ws.onclose = null; this.ws.close(); }
      if (this.ctx) this.ctx.close();
      if (this.playCtx) this.playCtx.close();
    }
  }

  // ---------- Démarrage / arrêt ----------

  let engine = null;
  let mediaStream = null;
  let listeningLabel = 'Écoute en cours';
  let wakeLock = null;

  async function getAudioStream(source) {
    if (source === 'mic') {
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
    if (source === 'speaker' || source === 'youtube') {
      // Sans annulation d'écho ni réduction de bruit : ces filtres effacent justement le son
      // du haut-parleur (la réunion Zoom, Meet ou WhatsApp qui se déroule sur ce téléphone).
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    }
    if (source === 'file') return fileStream();
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Le partage d\'onglet n\'est pas disponible sur cet appareil (utilisez un ordinateur avec Chrome ou Edge).');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: true },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Aucun son partagé : recommencez et cochez « Partager l\'audio ».');
    }
    return stream;
  }

  // ---------- Fichier audio ou vidéo ----------

  // Le son du lecteur passe par Web Audio : on l'entend, et le moteur reçoit le même flux.
  // createMediaElementSource ne peut être appelé qu'une fois par élément : le graphe est conservé.
  const filePlayer = { ctx: null, node: null, gain: null, dest: null };

  // Appelé pendant le clic sur « Démarrer » (le navigateur exige un geste pour lancer le son).
  function prepareFilePlayback() {
    const player = $('player');
    if (!player.getAttribute('src')) throw new Error('Choisissez d\'abord un fichier audio ou vidéo.');
    if (!filePlayer.ctx) {
      filePlayer.ctx = watchContext(new AudioContext());
      filePlayer.node = filePlayer.ctx.createMediaElementSource(player);
      filePlayer.gain = filePlayer.ctx.createGain();
      filePlayer.node.connect(filePlayer.gain).connect(filePlayer.ctx.destination);
    }
    filePlayer.ctx.resume();
    filePlayer.gain.gain.value = 1;
    filePlayer.dest = filePlayer.ctx.createMediaStreamDestination();
    filePlayer.node.connect(filePlayer.dest);
    player.play().catch(() => {});
  }

  function fileStream() {
    return filePlayer.dest.stream;
  }

  function releaseFilePlayback() {
    if (!filePlayer.dest) return;
    filePlayer.node.disconnect(filePlayer.dest);
    filePlayer.dest = null;
    $('player').pause();
  }

  function setPlayerFile(blob, name) {
    const player = $('player');
    if (player.src) URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(blob);
    player.classList.toggle('audio-only', (blob.type || '').startsWith('audio/'));
    $('fileName').textContent = name;
    $('source').value = 'file';
    saveSettings();
    applyDisplaySettings();
  }

  // Fichier reçu par « Partager → Traducteur de Cours » (voir sw.js).
  async function loadSharedFile() {
    if (!new URLSearchParams(location.search).has('shared') || !('caches' in self)) return;
    history.replaceState(null, '', location.pathname);
    try {
      const cache = await caches.open('traducteur-cours-partage');
      const res = await cache.match('fichier-partage');
      if (!res) return;
      const name = decodeURIComponent(res.headers.get('X-File-Name') || 'fichier partagé');
      setPlayerFile(await res.blob(), name);
      await cache.delete('fichier-partage');
      setStatus(`Fichier reçu : ${name} — appuyez sur Démarrer`);
    } catch { /* stockage indisponible */ }
  }

  // ---------- Vidéo YouTube lue dans l'application ----------
  // Lire la vidéo dans l'application permet de baisser son volume et de suivre ses pauses, ce qu'aucun
  // site ne peut faire avec l'application YouTube du téléphone. Le son est capté par le micro.

  const yt = { player: null, api: null };

  function youtubeId(url) {
    const text = (url || '').trim();
    const m = text.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    if (m) return m[1];
    return /^[\w-]{11}$/.test(text) ? text : null;
  }

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (!yt.api) {
      yt.api = new Promise((resolve, reject) => {
        window.onYouTubeIframeAPIReady = resolve;
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = () => { yt.api = null; reject(new Error('Impossible de charger YouTube : vérifiez la connexion.')); };
        document.head.append(script);
      });
    }
    return yt.api;
  }

  async function loadYouTube() {
    const id = youtubeId($('ytUrl').value);
    if (!id) { setStatus('Lien YouTube non reconnu : copiez le lien de la vidéo (bouton « Partager » de YouTube).', 'error'); return; }
    saveSettings();
    setStatus('Chargement de la vidéo…');
    try {
      await loadYouTubeApi();
      if (yt.player && yt.player.cueVideoById) yt.player.cueVideoById(id);
      else {
        await new Promise((resolve) => {
          yt.player = new YT.Player('ytPlayer', {
            videoId: id,
            playerVars: { playsinline: 1, rel: 0 },
            events: { onReady: resolve, onStateChange: onYouTubeState, onError: () => setStatus('Cette vidéo ne peut pas être lue ici (lecture intégrée désactivée par son auteur).', 'error') },
          });
        });
      }
      if (!engine) setStatus('Vidéo prête — appuyez sur Démarrer');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  function onYouTubeState(e) {
    if (e.data === 2) onMediaPaused(); // en pause
    else if (e.data === 1) onMediaPlaying(); // en lecture
    else if (e.data === 0) onMediaEnded(); // terminée
  }

  // ---------- Reprise du son après une mise en veille ----------
  // Android et iOS suspendent le son d'une page quand on passe dans une autre application ou pendant
  // un appel. On relance tous les contextes audio dès que possible ; si le navigateur exige un geste,
  // un bandeau demande de toucher l'écran.
  const audioContexts = new Set();

  function watchContext(ctx) {
    if (!ctx) return ctx;
    audioContexts.add(ctx);
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'closed') audioContexts.delete(ctx);
      else if (ctx.state !== 'running' && engine) resumeAudio();
    });
    return ctx;
  }

  async function resumeAudio() {
    if (!engine) return;
    await Promise.all([...audioContexts].map((ctx) => (ctx.state !== 'running' && ctx.state !== 'closed' ? ctx.resume().catch(() => {}) : null)));
    const stuck = [...audioContexts].some((ctx) => ctx.state !== 'running' && ctx.state !== 'closed');
    $('resumeBanner').hidden = !stuck;
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeAudio(); });
  document.addEventListener('pointerdown', () => { if (!$('resumeBanner').hidden) resumeAudio(); }, true);

  // Filet de sécurité : une erreur imprévue est signalée, l'écoute continue.
  self.addEventListener('error', (e) => { if (engine) showWarning(`Incident : ${e.message || 'erreur inattendue'} — l'écoute continue.`); });
  self.addEventListener('unhandledrejection', (e) => {
    if (engine) showWarning(`Incident : ${(e.reason && e.reason.message) || 'erreur inattendue'} — l'écoute continue.`);
  });

  // ---------- Baisse du son d'origine pendant la voix de la traduction ----------
  // Possible quand l'application diffuse elle-même le son d'origine : fichier, ou onglet partagé sur
  // ordinateur (l'onglet est rendu muet et l'application rejoue son son). Les autres applications
  // d'un téléphone (YouTube, Zoom…) ne peuvent pas être contrôlées par une page web.
  const DUCK_LEVEL = 0.2;
  let tabReplay = null; // { ctx, gain } : son de l'onglet partagé, rejoué par l'application
  let duckTimer = null;

  function voiceActive() {
    return !!(engine && engine.voicePlaying && engine.voicePlaying())
      || ('speechSynthesis' in self && speechSynthesis.speaking);
  }

  let autoPaused = false; // la vidéo a été mise en pause par l'application, le temps de la voix
  let voiceEndedAt = 0;

  function mediaIsPlaying() {
    if ($('source').value === 'file') return !$('player').paused && !$('player').ended;
    return !!(yt.player && yt.player.getPlayerState && yt.player.getPlayerState() === 1);
  }
  function pauseMedia() { if ($('source').value === 'file') $('player').pause(); else if (yt.player) yt.player.pauseVideo(); }
  function playMedia() { if ($('source').value === 'file') $('player').play().catch(() => {}); else if (yt.player) yt.player.playVideo(); }

  function startDucking() {
    clearInterval(duckTimer);
    let last = 1;
    duckTimer = setInterval(() => {
      const voice = speakEnabled() && voiceActive();
      if (voice) voiceEndedAt = 0; else if (!voiceEndedAt) voiceEndedAt = Date.now();

      // Pause automatique : la vidéo attend que l'interprète ait fini (rien n'est manqué).
      if (controlledSource() && $('autoPause').checked) {
        if (voice && !autoPaused && mediaIsPlaying()) { autoPaused = true; pauseMedia(); }
        else if (!voice && autoPaused && Date.now() - voiceEndedAt > 400) { playMedia(); setTimeout(() => { autoPaused = false; }, 300); }
      }

      const target = $('duck').checked && voice ? DUCK_LEVEL : 1;
      $('duckBadge').hidden = target === 1 && !autoPaused;
      $('duckBadge').textContent = autoPaused ? '⏸' : '🔉';
      if (target === last) return;
      last = target;
      for (const audio of [filePlayer, tabReplay]) {
        if (audio && audio.ctx && audio.gain) audio.gain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.12);
      }
      if ($('source').value === 'youtube' && yt.player && yt.player.setVolume) yt.player.setVolume(Math.round(target * 100));
    }, 100);
  }

  function stopDucking() {
    clearInterval(duckTimer);
    duckTimer = null;
    $('duckBadge').hidden = true;
    if (autoPaused) { autoPaused = false; }
    if (yt.player && yt.player.setVolume) yt.player.setVolume(100);
    if (filePlayer.gain) filePlayer.gain.gain.value = 1;
    if (tabReplay) { tabReplay.ctx.close(); tabReplay = null; }
  }

  // L'onglet partagé a été rendu muet par le navigateur : l'application rejoue son son.
  function replayTab(stream, ctx) {
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    if (!ctx || !settings.suppressLocalAudioPlayback) {
      if (ctx) ctx.close();
      if (speakEnabled() && $('duck').checked) showWarning('Ce navigateur ne permet pas de baisser le son de l\'onglet : baissez un peu son volume.');
      return;
    }
    const gain = ctx.createGain();
    ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
    ctx.resume();
    tabReplay = { ctx, gain };
  }

  async function start() {
    saveSettings();
    const source = $('source').value;
    const engineName = $('engine').value;
    const lang = $('srcLang').value;
    $('startBtn').disabled = true;
    // Créé avant toute attente, tant que le clic compte encore comme geste de l'utilisateur.
    const livePlayCtx = watchContext(engineName === 'live' && speakEnabled() ? new AudioContext() : null);
    echoGuard = source === 'speaker' || source === 'youtube';
    const tabCtx = watchContext(source === 'tab' ? new AudioContext() : null);
    if (source === 'file') {
      try { prepareFilePlayback(); } catch (err) { $('startBtn').disabled = false; setStatus(err.message, 'error'); return; }
    }
    if (source === 'youtube') {
      if (!yt.player || !yt.player.playVideo) {
        $('startBtn').disabled = false;
        setStatus('Collez le lien de la vidéo YouTube puis appuyez sur « Charger ».', 'error');
        return;
      }
      yt.player.playVideo();
    }

    try {
      if (engineName === 'browser' && !SpeechRecognition) {
        throw new Error('Reconnaissance vocale indisponible dans ce navigateur. Utilisez Chrome/Edge ou le moteur Whisper.');
      }
      if (engineName === 'whisper' && !$('apiKey').value.trim()) {
        $('whisperSettings').open = true;
        throw new Error('Entrez une clé API pour le moteur Whisper.');
      }
      if ((engineName === 'gemini' || engineName === 'live') && !$('geminiKey').value.trim()) {
        $('geminiSettings').open = true;
        throw new Error('Entrez votre clé API Gemini (gratuite sur aistudio.google.com/apikey).');
      }

      let provider = engineName;
      if (engineName !== 'gemini' && engineName !== 'live') {
        setStatus('Préparation de la traduction…');
        provider = await translator.configure($('translator').value, lang, $('tgtLang').value, (p) => {
          setStatus(`Téléchargement du modèle de traduction… ${Math.round(p * 100)} %`);
        });
      }

      // Le moteur du navigateur gère lui-même le micro ; sinon on capture le flux audio.
      if (engineName !== 'browser' || source !== 'mic') {
        setStatus('Choix de la source audio…');
        mediaStream = await getAudioStream(source);
        if (source === 'tab') replayTab(mediaStream, tabCtx);
      }

      const handlers = {
        onInterim,
        onLive: (translation, original) => showLive(translation, original, true),
        onFinal,
        onWarning: (msg) => { console.warn(msg); showWarning(msg); },
        onFatal: (msg) => { stop(); setStatus(msg, 'error'); },
        onReconnecting: (on) => {
          if (!engine) return;
          if (on) setStatus('🔄 Reconnexion à Gemini…', 'listening');
          else setStatus(listeningLabel, 'listening');
        },
      };

      if (engineName === 'browser') {
        engine = new BrowserEngine({ lang, track: mediaStream ? mediaStream.getAudioTracks()[0] : null }, handlers);
      } else if (engineName === 'live') {
        engine = new GeminiLiveEngine({
          stream: mediaStream,
          apiKey: $('geminiKey').value.trim(),
          model: $('liveModel').value.trim() || 'gemini-3.5-live-translate-preview',
          targetLang: $('tgtLang').value,
          playCtx: livePlayCtx,
        }, handlers);
      } else if (engineName === 'gemini') {
        const optionText = (id) => $(id).selectedOptions[0].dataset.name || $(id).selectedOptions[0].textContent;
        engine = new GeminiEngine({
          stream: mediaStream,
          lang,
          apiKey: $('geminiKey').value.trim(),
          model: $('geminiModel').value.trim() || 'gemini-3.1-flash-lite',
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
      engine.echoGuard = echoGuard;
      await engine.start();
      startDucking();

      try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* facultatif */ }

      const providerNames = { live: 'Gemini Live (simultanée)', gemini: 'Gemini', builtin: 'Chrome hors ligne', google: 'Google', mymemory: 'MyMemory' };
      listeningLabel = `Écoute en cours — traduction : ${providerNames[provider]}`;
      setStatus(listeningLabel, 'listening');
      // Sur téléphone, on amène la traduction à l'écran.
      if (matchMedia('(max-width: 700px)').matches) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
      showLive('', '', false);
      $('stopBtn').disabled = false;
    } catch (err) {
      if (livePlayCtx && !engine) livePlayCtx.close();
      if (tabCtx && !tabReplay) tabCtx.close().catch(() => {});
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
    releaseFilePlayback();
    stopDucking();
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
      if (videoPipSupported()) { toggleVideoPip().catch((err) => showWarning(`Sous-titres flottants : ${err.message}`)); return; }
      alert('Les sous-titres flottants ne sont pas disponibles dans ce navigateur. Essayez Chrome. '
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

  // ---------- Sous-titres flottants sur téléphone (Picture-in-Picture vidéo) ----------
  // Android et iOS n'ont pas de fenêtre flottante pour une page web, mais en ont une pour les vidéos :
  // la traduction est dessinée dans un canevas filmé en continu, et cette « vidéo » flotte au-dessus
  // de Zoom, Meet ou WhatsApp.

  const videoPip = { video: null, canvas: null, timer: null, text: ['', ''] };

  function videoPipSupported() {
    return !!(document.pictureInPictureEnabled && 'requestPictureInPicture' in HTMLVideoElement.prototype
      && 'captureStream' in HTMLCanvasElement.prototype);
  }

  function wrapLines(g, text, width) {
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > width && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawVideoPip() {
    const c = videoPip.canvas;
    const g = c.getContext('2d');
    g.fillStyle = '#0b1020';
    g.fillRect(0, 0, c.width, c.height);
    const [translation, original] = videoPip.text;
    // Sens d'écriture propre à chaque texte (arabe de droite à gauche, anglais de gauche à droite).
    const writeDir = (text) => {
      const rtl = /[\u0590-\u08FF]/.test(text);
      g.direction = rtl ? 'rtl' : 'ltr';
      g.textAlign = rtl ? 'right' : 'left';
      return rtl ? c.width - 28 : 28;
    };
    g.font = '600 38px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    const x = writeDir(translation);
    wrapLines(g, translation || '…', c.width - 56).slice(-3).forEach((l, i) => g.fillText(l, x, 58 + i * 48));
    if (original && $('showOriginal').checked) {
      g.font = 'italic 24px system-ui, sans-serif';
      g.fillStyle = '#9ca3af';
      g.fillText(wrapLines(g, original, c.width - 56).slice(-1)[0] || '', writeDir(original), c.height - 22);
    }
  }

  async function toggleVideoPip() {
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
    if (!videoPip.video) {
      videoPip.canvas = Object.assign(document.createElement('canvas'), { width: 720, height: 240 });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0';
      video.srcObject = videoPip.canvas.captureStream(5);
      video.addEventListener('leavepictureinpicture', () => { clearInterval(videoPip.timer); videoPip.timer = null; });
      document.body.append(video);
      videoPip.video = video;
    }
    drawVideoPip();
    clearInterval(videoPip.timer);
    videoPip.timer = setInterval(drawVideoPip, 250);
    await videoPip.video.play();
    await videoPip.video.requestPictureInPicture();
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
  saveSettings();
  adaptToDevice();
  applyDisplaySettings();
  for (const id of SETTING_FIELDS) {
    $(id).addEventListener('change', () => { saveSettings(); applyDisplaySettings(); });
  }
  $('fontSize').addEventListener('input', applyDisplaySettings);
  $('geminiKey').addEventListener('input', applyDisplaySettings);
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setPlayerFile(file, file.name);
  });
  // Pause / reprise du fichier par l'utilisateur (pas les pauses automatiques pendant la voix).
  function onMediaPaused() {
    if (!engine || autoPaused) return;
    if (engine.pauseInput) engine.pauseInput();
    setStatus('⏸ En pause — la traduction reprend avec la vidéo', 'listening');
  }
  function onMediaPlaying() {
    if (!engine || autoPaused) return;
    if (engine.resumeInput) engine.resumeInput();
    setStatus(listeningLabel, 'listening');
  }
  $('player').addEventListener('pause', () => { if (!$('player').ended) onMediaPaused(); });
  $('player').addEventListener('play', onMediaPlaying);
  $('resumeBanner').addEventListener('click', resumeAudio);

  // Fin du fichier ou de la vidéo : on attend la traduction des dernières phrases, puis on arrête.
  $('player').addEventListener('ended', () => onMediaEnded());
  $('ytLoad').addEventListener('click', loadYouTube);
  $('ytUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadYouTube(); });

  async function onMediaEnded() {
    if (!engine || !controlledSource()) return;
    const current = engine;
    setStatus('Fin de la lecture — traduction des dernières phrases…', 'listening');
    await new Promise((r) => setTimeout(r, 700)); // le silence de fin termine la phrase en cours
    await current.finish();
    await finalChain;
    if (engine !== current) return;
    stop();
    setStatus('Lecture terminée — la traduction complète est dans l\'historique');
  }
  loadSharedFile();
  // Accès en lecture pour le diagnostic et les tests automatiques.
  self.traducteurDiagnostic = { engine: () => engine, voiceActive: () => voiceActive() };
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
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
})();
