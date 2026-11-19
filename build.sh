#!/bin/sh
# Build the .xpi (a zip with the plugin files at the root).
set -e
cd "$(dirname "$0")"
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/send2remarkable-$V.xpi"
zip -q -r -X "dist/send2remarkable-$V.xpi" manifest.json bootstrap.js prefs.js prefs.xhtml
echo "dist/send2remarkable-$V.xpi"
