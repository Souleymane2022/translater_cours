# Vidéos de présentation

| Fichier | Contenu |
|---|---|
| `tutoriel-traducteur-de-cours.mp4` | **Tutoriel pratique, 79 s, vertical 1080×1920, avec voix.** L'application réelle filmée sur un téléphone : ouvrir le site, choisir Gemini Live, ajouter la clé, choisir la langue, démarrer ; puis un prof parle anglais et l'interprète traduit en direct en français, en espagnol, puis en arabe (texte). |
| `demo-traducteur-de-cours.mp4` | Animation courte (36 s), textes et musique, sans voix. |

## Comment le tutoriel est fabriqué (`tutoriel/`)

1. `prepare.py` lit `script.json`, obtient les **vraies traductions Google** des phrases du prof et génère
   les voix (narrateur, prof, interprètes) avec la synthèse vocale Kokoro.
   Chaque voix a été vérifiée par reconnaissance vocale (Whisper).
2. `record.js` filme **l'application réelle** dans `stage.html` et la pilote comme un utilisateur.
   Seul le serveur Gemini Live est simulé : il renvoie, au rythme de la parole, le texte et la voix
   préparés à l'étape 1 (sans clé personnelle, impossible d'appeler le vrai Gemini pendant le tournage).
3. `build.py` assemble les images, les voix à leur instant exact et une musique discrète (`../music.py`).

```bash
python prepare.py <modèles_kokoro> clips
node record.js clips rec          # le site doit être servi sur http://localhost:8765
python build.py rec tutoriel.mp4
```
