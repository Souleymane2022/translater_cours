# Vidéos de présentation

| Fichier | Contenu |
|---|---|
| `tutoriel-traducteur-de-cours.mp4` | **Tutoriel pratique, 79 s, vertical 1080×1920, avec voix.** L'application réelle filmée sur un téléphone : ouvrir le site, choisir Gemini Live, ajouter la clé, choisir la langue, démarrer ; puis un prof parle anglais et l'interprète traduit en direct en français, en espagnol, puis en arabe (texte). |
| `tutoriel-ordinateur-traducteur-de-cours.mp4` | **Version ordinateur, 53 s, horizontal 1920×1080 (YouTube, Facebook, LinkedIn).** Un cours en ligne en anglais dans un onglet : choisir « Audio d'un onglet », partager l'onglet avec son audio, activer les sous-titres flottants ; la prof parle et la traduction française s'affiche au-dessus de la vidéo avec la voix de l'interprète. Rappel pour l'application Zoom sur Windows (écran entier + audio du système). |
| `demo-traducteur-de-cours.mp4` | Animation courte (36 s), textes et musique, sans voix. |

## Comment le tutoriel est fabriqué (`tutoriel/`)

1. `prepare.py` lit `script.json`, obtient les **vraies traductions Google** des phrases du prof et génère
   les voix (narrateur, prof, interprètes) avec la synthèse vocale Kokoro.
   Chaque voix a été vérifiée par reconnaissance vocale (Whisper).
2. `record.js` filme **l'application réelle** dans `stage.html` et la pilote comme un utilisateur.
   Seul le serveur Gemini Live est simulé : il renvoie, au rythme de la parole, le texte et la voix
   préparés à l'étape 1 (sans clé personnelle, impossible d'appeler le vrai Gemini pendant le tournage).
3. `build.py` assemble les images, les voix à leur instant exact et une musique discrète (`../music.py`).

La version ordinateur utilise `script-ordinateur.json`, `stage-ordinateur.html`, `cours.html` (page de cours
générique) et `record-ordinateur.js`. La fenêtre de partage et la fenêtre des sous-titres flottants sont
dessinées par le plateau (les vraies fenêtres du navigateur ne peuvent pas être filmées), mais c'est le vrai
code de l'application qui les ouvre et y affiche la traduction.

```bash
python prepare.py <modèles_kokoro> clips_pc script-ordinateur.json
node record-ordinateur.js clips_pc rec_pc
python build.py rec_pc tutoriel-ordinateur.mp4

python prepare.py <modèles_kokoro> clips
node record.js clips rec          # le site doit être servi sur http://localhost:8765
python build.py rec tutoriel.mp4
```
