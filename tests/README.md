# Tests de bout en bout multilingues

`langues-e2e.js` teste **l'application réelle** dans Chromium : une vraie voix (fichier WAV) est envoyée
dans le micro de l'application, le moteur « Whisper » la reconnaît, la traduction Google la traduit, et le
test lit ce qui s'affiche dans l'historique (y compris le sens d'écriture, droite-à-gauche pour l'arabe).

La reconnaissance vocale tourne en local grâce à `serveur_whisper_local.py` (Whisper « small » via
sherpa-onnx), compatible avec l'API `/v1/audio/transcriptions` d'OpenAI.

```bash
python3 -m http.server 8765                                  # à la racine du dépôt
WHISPER_DIR=chemin/vers/sherpa-onnx-whisper-small python serveur_whisper_local.py
node langues-e2e.js dossier_des_voix                         # src_en.wav, src_fr.wav, src_es.wav, src_pt.wav, src_it.wav
```

## Résultats (13 octobre 2026)

Voix de synthèse Kokoro → micro de l'application → Whisper → Google Traduction → affichage. **10/10 réussis.**

| Langue parlée → traduction | Exemple affiché par l'application |
|---|---|
| Anglais → Français | « Les plantes utilisent la lumière du soleil pour transformer l'eau et le dioxyde de carbone en sucre. » |
| Anglais → Arabe (droite à gauche ✅) | « صباح الخير للجميع. » |
| Anglais → Espagnol | « Hoy vamos a hablar de la fotosíntesis. » |
| Anglais → Swahili | « Habari za asubuhi, kila mtu. » |
| Anglais → Haoussa | « Barka da safiya, kowa da kowa. » |
| Anglais → Chinois | « 今天我们要讲的是光合作用。 » |
| Français → Anglais | « Hello everyone. Today we will study the French Revolution. It begins in 1789. » |
| Espagnol → Français | « Bonjour, aujourd'hui nous allons étudier les fractions. » |
| Portugais → Français | « Bonjour à tous ! Aujourd'hui, nous allons parler du cycle de l'eau et de l'évaporation. » |
| Italien → Arabe | « صباح الخير للجميع، اليوم نتحدث عن تاريخ الإمبراطورية الرومانية. » |

Le moteur Gemini Live n'est pas couvert par ces tests (il demande une clé personnelle) ; il est vérifié
avec un serveur simulé qui contrôle le format des messages, la reconnexion et l'affichage en continu.

## Fonctions « téléphone » (`telephone-e2e.js`)

```bash
node telephone-e2e.js voix_espagnol.wav dossier_sortie
```

Vérifie, dans l'application réelle : la traduction d'un fichier audio pendant sa lecture (vraie voix espagnole →
Whisper local → Google Traduction → « Bonjour, aujourd'hui nous allons étudier les fractions… ») et l'arrêt
automatique en fin de fichier ; l'ouverture du micro sans annulation d'écho en mode « Réunion sur ce téléphone » ;
les sous-titres flottants par Picture-in-Picture vidéo (texte arabe de droite à gauche) ; la réception d'un fichier
partagé depuis une autre application. **12/12 réussis.**

## Robustesse (`robustesse-e2e.js`)

```bash
node robustesse-e2e.js
```

Reproduit les causes de « ça s'arrête et ça répète le même texte » et vérifie leur correction : en mode
« Réunion sur ce téléphone », la voix de la traduction est jouée sans boucle (Gemini Live ignore ce qui est
déjà dans la langue cible ; les autres moteurs mettent l'écoute en pause pendant que la voix parle, puis la
reprennent) ; une phrase renvoyée deux fois n'est affichée qu'une fois ; une session Gemini Live figée (parole
entendue sans réponse pendant 12 s) est remplacée par une session neuve ; la reconnaissance Android qui renvoie
tout le texte déjà reconnu ne produit que les mots nouveaux. **11/11 réussis.**
