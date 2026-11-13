# Bibliothèques embarquées

`anthropic-sdk.js` est le SDK officiel d'Anthropic (`@anthropic-ai/sdk`, version 1.8.0), regroupé
en un seul fichier pour que l'application fonctionne sans étape de construction et sans dépendre
d'un serveur tiers au moment où vous saisissez votre clé API.

Pour le mettre à jour :

```bash
mkdir /tmp/sdk && cd /tmp/sdk && npm init -y && npm install @anthropic-ai/sdk esbuild
echo 'export { default } from "@anthropic-ai/sdk";' > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser --target=es2020 --minify \
  --outfile=anthropic-sdk.js
```

Puis copiez `anthropic-sdk.js` ici, ainsi que les fichiers `LICENSE` et `LICENSE-MIT` du paquet.
