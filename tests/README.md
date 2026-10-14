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

## Vidéo en pause et volume d'origine (`echo-volume-e2e.js`)

```bash
node echo-volume-e2e.js fichier_audio.wav
```

Vérifie qu'en mode « Réunion sur ce téléphone » l'écho d'une traduction déjà dite est jeté (texte **et** voix)
tandis qu'une nouvelle phrase au même début passe ; que le micro n'envoie que du silence pendant que
l'interprète parle, puis reprend ; qu'après 1,5 s de silence (vidéo en pause) plus rien n'est envoyé à Gemini ;
que le son d'origine d'un fichier ou d'un onglet partagé baisse pendant la voix puis remonte. **10/10 réussis.**

## Pause, résistance et vidéo YouTube (`pause-youtube-e2e.js`)

```bash
node pause-youtube-e2e.js fichier_audio.wav
```

Vérifie que la mise en pause d'une vidéo prévient Gemini (`audioStreamEnd`) et que la traduction reprend avec
la lecture ; que les coupures passagères (quota par minute, erreur serveur, premier échec de connexion) sont
suivies d'une reconnexion automatique sans arrêter l'écoute, alors qu'une clé refusée arrête avec un message
clair ; qu'un message inattendu ne plante rien ; et qu'une vidéo YouTube lue dans l'application voit son volume
baisser pendant la voix, sa pause suivie, et se met en pause automatiquement si l'option est cochée.
Sur téléphone (Android simulé), la vidéo se met en pause pendant la voix, car YouTube y ignore les changements de volume. (Le lecteur YouTube est simulé.) **24/24 réussis.**

## Comportement réel de Gemini Live (`gemini-reel-e2e.js`)

```bash
node gemini-reel-e2e.js
```

Reproduit ce qu'a montré un enregistrement d'écran sur téléphone (vidéo YouTube dans l'application) : Gemini
envoie de l'audio en continu, y compris du silence, et ne termine jamais ses tours. Avant correction : volume
YouTube bloqué à 20 %, micro coupé, traduction figée, historique vide (le test échoue sur l'ancienne version).
Vérifie que le volume remonte et que le micro se rouvre dès que la voix **audible** s'arrête, que l'historique
se remplit phrase par phrase (et après 2,5 s sans nouveau texte), et que le micro n'est jamais coupé plus de 8 s.
**5/5 réussis.**

## Voix complète et sans coupure (`voix-sync-e2e.js`)

```bash
node voix-sync-e2e.js
```

Gemini envoie la voix par rafales, plus vite que le temps réel, mêlée de silences. Avant correction, au-delà de
3 s de retard l'application « sautait au direct » : 46 morceaux se superposaient dans une rafale de 5 s et la
voix était hachée (le test échoue sur l'ancienne version). Vérifie que toute la parole est jouée sans
superposition, que les silences en attente sont retirés, que la voix accélère au plus de 15 % ; et que la
synthèse vocale des autres moteurs lit toutes les phrases (aucune abandonnée), un peu plus vite si elles
s'accumulent. **6/6 réussis.**
