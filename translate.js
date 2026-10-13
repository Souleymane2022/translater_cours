// Services de traduction. Expose window.TranslationService.
(function () {
  'use strict';

  const CACHE_LIMIT = 500;
  const PREPARE_TIMEOUT_MS = 10000; // au-delà, on passe au service suivant (le modèle peut finir de se télécharger)

  async function fetchJson(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Découpe un texte long en morceaux ≤ max caractères, en coupant sur la ponctuation ou les espaces.
  function splitText(text, max) {
    const parts = [];
    let rest = text.trim();
    while (rest.length > max) {
      let cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf(', ', max));
      if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      parts.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  const providers = {
    // API Translator intégrée à Chrome (138+) : hors ligne, après téléchargement du modèle.
    builtin: {
      instances: new Map(),
      async supported(src, tgt) {
        if (!('Translator' in self)) return false;
        try {
          const a = await self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
          return a !== 'unavailable';
        } catch { return false; }
      },
      // Doit être appelé depuis un geste utilisateur (clic) si le modèle doit être téléchargé.
      async prepare(src, tgt, onProgress) {
        const key = `${src}>${tgt}`;
        if (!this.instances.has(key)) {
          this.instances.set(key, self.Translator.create({
            sourceLanguage: src,
            targetLanguage: tgt,
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => onProgress && onProgress(e.loaded));
            },
          }));
        }
        try {
          return await this.instances.get(key);
        } catch (err) {
          this.instances.delete(key);
          throw err;
        }
      },
      async translate(text, src, tgt) {
        const t = await this.prepare(src, tgt);
        return t.translate(text);
      },
    },

    // Point d'accès public de Google Traduction (non officiel, gratuit, sans clé).
    google: {
      async supported() { return true; },
      async prepare() {},
      async translate(text, src, tgt, signal) {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
          + `&sl=${encodeURIComponent(src)}&tl=${encodeURIComponent(tgt)}&q=${encodeURIComponent(text)}`;
        const data = await fetchJson(url, signal);
        return data[0].map((seg) => seg[0]).join('');
      },
    },

    // MyMemory : gratuit, limité à ~500 caractères par requête et à un quota journalier.
    mymemory: {
      async supported() { return true; },
      async prepare() {},
      async translate(text, src, tgt, signal) {
        const out = [];
        for (const part of splitText(text, 480)) {
          const url = 'https://api.mymemory.translated.net/get'
            + `?q=${encodeURIComponent(part)}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(tgt)}`;
          const data = await fetchJson(url, signal);
          if (data.responseStatus && Number(data.responseStatus) !== 200) {
            throw new Error(data.responseDetails || 'MyMemory: erreur');
          }
          out.push(data.responseData.translatedText);
        }
        return out.join(' ');
      },
    },
  };

  class TranslationService {
    constructor() {
      this.mode = 'auto';
      this.src = 'en';
      this.tgt = 'fr';
      this.chain = ['google', 'mymemory'];
      this.cache = new Map();
    }

    // Configure la chaîne de services. À appeler au clic sur « Démarrer ».
    async configure(mode, src, tgt, onProgress) {
      this.mode = mode;
      this.src = src.split('-')[0];
      this.tgt = tgt;
      this.cache.clear();

      const candidates = mode === 'auto' ? ['builtin', 'google', 'mymemory'] : [mode, 'google', 'mymemory'];
      const chain = [];
      for (const name of new Set(candidates)) {
        const p = providers[name];
        if (!(await p.supported(this.src, this.tgt))) continue;
        try {
          await Promise.race([
            p.prepare(this.src, this.tgt, onProgress),
            new Promise((_, reject) => setTimeout(() => reject(new Error('préparation trop longue')), PREPARE_TIMEOUT_MS)),
          ]);
          chain.push(name);
        } catch (err) {
          console.warn(`Traduction « ${name} » indisponible :`, err);
        }
      }
      this.chain = chain.length ? chain : ['google', 'mymemory'];
      return this.chain[0];
    }

    async translate(text, signal) {
      text = text.trim();
      if (!text) return '';
      if (this.src === this.tgt) return text;
      if (this.cache.has(text)) return this.cache.get(text);

      let lastErr;
      for (const name of this.chain) {
        try {
          const result = await providers[name].translate(text, this.src, this.tgt, signal);
          if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(text, result);
          return result;
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          lastErr = err;
          console.warn(`Échec de la traduction via « ${name} » :`, err);
        }
      }
      throw lastErr || new Error('Aucun service de traduction disponible');
    }
  }

  self.TranslationService = TranslationService;
  self.splitText = splitText;
})();
