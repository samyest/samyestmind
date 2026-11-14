#!/usr/bin/env bash
# Regera vendor/daisyui-<versão>.css: o daisyUI inteiro, com prefixo "d-".
#
# Uso: bash scripts/daisyui/gerar.sh
#
# O app não tem build: o arquivo gerado é versionado e servido como está.
# Este script só roda quando a versão do daisyUI muda. Para atualizar, troque
# DAISYUI por uma versão publicada há pelo menos duas semanas (a mesma regra do
# supabase-js no CLAUDE.md), rode, troque o <link> no index.html e apague o
# arquivo da versão anterior. Por que o prefixo: docs/rfc/0007-daisyui.md.
set -euo pipefail

DAISYUI=5.7.50
TAILWIND=4.3.3

raiz="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$tmp"
npm init -y >/dev/null
# --ignore-scripts: nenhum pacote roda código na instalação.
npm install --ignore-scripts --save-exact --no-audit --no-fund \
  "daisyui@$DAISYUI" "@tailwindcss/cli@$TAILWIND" "tailwindcss@$TAILWIND" >/dev/null

node "$raiz/scripts/daisyui/entrada.mjs" node_modules/daisyui/daisyui.css > entrada.css
npx --no-install tailwindcss -i entrada.css -o saida.css --minify

destino="$raiz/vendor/daisyui-$DAISYUI.css"
mkdir -p "$raiz/vendor"
{
  printf '/*! daisyUI %s | MIT License | https://github.com/saadeghi/daisyui */\n' "$DAISYUI"
  printf '/* Com prefixo d-. Gerado por scripts/daisyui/gerar.sh: não editar à mão. */\n'
  cat saida.css
} > "$destino"

echo "Gerado: vendor/daisyui-$DAISYUI.css ($(wc -c < "$destino") bytes)"
