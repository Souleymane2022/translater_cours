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
