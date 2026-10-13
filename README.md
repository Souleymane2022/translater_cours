# 🎓 Traducteur de Cours en direct (anglais → français)

Application web (installable comme une application sur PC et téléphone) qui **écoute ce que dit
l'interlocuteur en anglais et l'affiche — ou le lit à voix haute — en français, en temps réel**.
Idéale pour les cours en présentiel, les cours en ligne et les réunions Zoom / Google Meet / Teams.

Pas de serveur ni d'inscription : tout tourne dans le navigateur.

## ✨ Fonctionnalités

- **Sous-titres en direct** : la traduction s'affiche pendant que la personne parle, puis se fixe à la fin de chaque phrase.
- **Deux sources audio**
  - 🎤 **Microphone** : pour un cours en salle (posez le téléphone/PC près du professeur) ou pour capter les haut-parleurs.
  - 🖥️ **Audio d'un onglet / de l'écran** : capte directement le son de Zoom web, Meet, Teams web, YouTube… sans micro.
- **Sur téléphone, même pendant une réunion** :
  - 🔈 **« Réunion sur ce téléphone »** : capte le son du haut-parleur pendant Zoom, Meet ou WhatsApp
    (le micro est ouvert sans les filtres qui effacent ce son) ;
  - 🪟 **sous-titres flottants** au-dessus de Zoom, Meet ou WhatsApp, grâce à l'« image dans l'image »
    d'Android et d'iPhone ;
  - 📁 **fichier audio ou vidéo** : cours enregistré, vidéo téléchargée, message vocal d'un partenaire ;
  - 📤 **partage direct** : dans WhatsApp ou la galerie, « Partager » → « Traducteur de Cours »
    (application installée, Android).
- **Lecture à voix haute en français** (synthèse vocale) — utilisez des écouteurs.
- **Sous-titres flottants** : une petite fenêtre qui reste au-dessus de Zoom/Teams (Chrome/Edge sur ordinateur).
- **Plein écran**, taille du texte réglable, affichage optionnel du texte anglais original.
- **Historique** horodaté et **export** en fichier `.txt` (pratique pour réviser le cours).
- Empêche l'écran de se mettre en veille pendant l'écoute.
- **16 langues parlées** (anglais, français, espagnol, portugais, allemand, italien, arabe, russe, turc, hindi, chinois, japonais…)
  et **14 langues de traduction** (français, anglais, arabe, espagnol, portugais, allemand, italien, swahili, haoussa,
  turc, russe, hindi, chinois, japonais). L'arabe s'affiche de droite à gauche.

## 🚀 Utilisation

1. Ouvrez l'application dans **Google Chrome** ou **Microsoft Edge** (recommandé).
2. Choisissez la source audio et cliquez sur **▶ Démarrer la traduction**.
3. Autorisez le micro (ou choisissez l'onglet à partager et **cochez « Partager l'audio »**).

### Cas d'usage

| Situation | Réglage conseillé |
|---|---|
| Cours en salle, en anglais | Source : Microphone — Moteur : Gemini Live |
| Réunion Zoom/Meet/Teams **dans le navigateur** | Source : Audio d'un onglet — choisir l'onglet de la réunion |
| Application **Zoom de bureau** (Windows) | Source : Audio d'un onglet → « Écran entier » + « Partager l'audio du système » |
| Application Zoom de bureau (Mac) | Source : Microphone (le micro capte le son des haut-parleurs) |
| Réunion Zoom, Meet ou WhatsApp **sur le téléphone** | Source : Réunion sur ce téléphone + Sous-titres flottants, réunion en haut-parleur |
| Cours enregistré, vidéo téléchargée, message vocal | Source : Fichier audio ou vidéo (ou « Partager » → Traducteur de Cours) |
| Navigateur autre que Chrome/Edge (Firefox, Safari…) | Moteur : Whisper (clé API) |

## ⚙️ Moteurs

### Reconnaissance vocale
- **⚡ Gemini Live — traduction simultanée (recommandé)** : le son est envoyé en continu au modèle
  d'interprétation `gemini-3.5-live-translate-preview`. Le texte français s'écrit **pendant que l'orateur parle**,
  et avec « Lire la traduction à voix haute », on entend une **voix d'interprète** en français, comme une
  traduction simultanée. Même clé gratuite que ci-dessous. La session se reconnecte automatiquement
  si Google la coupe.
- **✨ Gemini phrase par phrase** : Gemini écoute chaque phrase et renvoie **en une seule
  requête** la transcription et une traduction naturelle, qui tient compte du contexte des phrases précédentes.
  Bien plus précis que la reconnaissance du navigateur, avec un délai de 2 à 4 s après chaque pause.
  1. Créez une clé gratuite sur <https://aistudio.google.com/apikey> (compte Google).
  2. Choisissez le moteur « Gemini », ouvrez « Réglages Gemini » et collez la clé.
  3. Modèle : `gemini-3.1-flash-lite` par défaut. Si le modèle est surchargé (erreur 503), trop lent ou retiré,
     l'application bascule automatiquement sur d'autres modèles Gemini et retient celui qui répond.
     Les noms changent avec le temps : la liste à jour est sur <https://ai.google.dev/gemini-api/docs/models>.
  - Le quota gratuit limite le nombre de requêtes par minute : l'application envoie des segments de 4 à 15 s pour rester dessous.
- **Navigateur (gratuit)** : reconnaissance vocale intégrée à Chrome/Edge. Rapide, avec affichage mot à mot.
  Pour l'audio d'un onglet, les versions récentes de Chrome savent l'utiliser directement ; sinon, utilisez Whisper.
- **Whisper / API compatible OpenAI** : fonctionne avec n'importe quelle source et sur tous les navigateurs récents.
  Le son est découpé automatiquement aux pauses et envoyé à l'API.
  - **Groq (offre gratuite)** : créez une clé sur <https://console.groq.com>, URL `https://api.groq.com/openai/v1`, modèle `whisper-large-v3-turbo`.
  - **OpenAI** : URL `https://api.openai.com/v1`, modèle `gpt-4o-mini-transcribe` (ou `whisper-1`).
  - La clé est enregistrée uniquement dans votre navigateur.

### Traduction
- **Automatique** : utilise le meilleur service disponible, avec repli automatique en cas d'échec.
- **Chrome intégré** : traduction hors ligne et privée (Chrome 138+ sur ordinateur, le modèle est téléchargé une seule fois).
- **Google Traduction** : gratuit, sans clé (point d'accès public non officiel).
- **MyMemory** : gratuit, quota journalier limité.

## 🌐 Mettre le site en ligne (gratuit) avec GitHub Pages

1. Sur GitHub : **Settings → Pages**.
2. *Source* : « Deploy from a branch », choisissez la branche et le dossier `/ (root)`, puis **Save**.
3. Le site sera disponible à l'adresse `https://<votre-nom>.github.io/translater_cours/`.
4. Sur téléphone ou PC, ouvrez ce lien puis « Installer l'application » / « Ajouter à l'écran d'accueil ».

> Le micro et le partage d'écran exigent **HTTPS** (GitHub Pages le fournit) ou `localhost`.

## 💻 Lancer en local

```bash
python3 -m http.server 8000
# puis ouvrez http://localhost:8000
```

## 📁 Structure

```
index.html            Interface
style.css             Styles (thème clair/sombre, mobile)
app.js                Reconnaissance vocale (navigateur, Whisper, Gemini, Gemini Live), affichage, sous-titres flottants, export
translate.js          Services de traduction (Chrome intégré, Google, MyMemory)
sw.js                 Service worker (installation en application)
manifest.webmanifest  Manifeste PWA
icon.svg              Icône
```

## ⚠️ Limites

- La reconnaissance vocale du navigateur envoie l'audio aux serveurs de Google/Microsoft (fonctionnement de Chrome/Edge).
- La qualité dépend du son : un micro proche de l'orateur donne de bien meilleurs résultats.
- La traduction automatique peut se tromper sur le vocabulaire technique : le texte original reste affiché pour vérifier.
