# Vidéo de démonstration

`demo-traducteur-de-cours.mp4` : vidéo verticale 1080×1920, 36 s, avec musique, prête à partager
(TikTok, Reels Instagram, Shorts YouTube, statut WhatsApp, Facebook).

## Modifier et régénérer la vidéo

- `demo.html` : l'animation (textes, couleurs, minutage). Ouvrez-la dans un navigateur pour la voir en boucle.
- `music.py` : la musique de fond, générée par le script (aucun droit d'auteur).
- `render.js` : filme `demo.html` image par image et assemble le MP4 avec ffmpeg.

```bash
python3 music.py music.wav      # nécessite numpy
node render.js .                # nécessite playwright et ffmpeg
```
