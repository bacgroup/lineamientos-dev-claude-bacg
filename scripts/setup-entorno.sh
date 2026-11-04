#!/usr/bin/env bash
# Setup de un entorno de Claude Code (nube o máquina nueva) para un proyecto de BACG.
# 1. Deja la copia de trabajo de los lineamientos donde el plugin la busca.
# 2. Habilita el plugin lineamientos-dev-claude-bacg (y superpowers) para todas las sesiones del entorno, en la configuración de usuario.
# Los repos del producto no llevan archivos del plugin: se reconocen por su remoto (proyectos/<id>/proyecto.yml).
# Uso: pegar este contenido en el "setup script" del entorno, o correrlo una vez en una PC nueva.
set -euo pipefail

REPO="https://github.com/bacgroup/lineamientos-dev-claude-bacg"
DEST="${BACG_LINEAMIENTOS_DIR:-$HOME/lineamientos-dev-claude-bacg}"
# En la nube, el entorno ya clona este repo junto a los del proyecto: esa es la copia que se commitea y pushea, y el
# plugin la usa primero. La de $DEST queda de respaldo (sesiones locales o un entorno sin el repo).
ENTORNO="${BACG_LINEAMIENTOS_ENTORNO:-/home/user/lineamientos-dev-claude-bacg}"

if [ -d "$DEST/.git" ]; then
  git -C "$DEST" pull --ff-only --quiet || echo "aviso: no pude actualizar $DEST"
else
  git clone --depth 1 "$REPO" "$DEST"
fi

node --version | grep -qE '^v(2[2-9]|[3-9][0-9])' || echo "aviso: el plugin necesita Node 22 o más"

mkdir -p "$HOME/.claude"
DEST="$DEST" ENTORNO="$ENTORNO" node -e '
const fs = require("fs"), path = require("path"), os = require("os");
const dir = path.join(os.homedir(), ".claude");
const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
const f = path.join(dir, "settings.json");
const s = leer(f);
s.extraKnownMarketplaces = { ...(s.extraKnownMarketplaces || {}),
  "lineamientos-dev-claude-bacg": { source: { source: "github", repo: "bacgroup/lineamientos-dev-claude-bacg" } },
  "superpowers-marketplace": { source: { source: "github", repo: "obra/superpowers-marketplace" } } };
s.enabledPlugins = { ...(s.enabledPlugins || {}),
  "lineamientos-dev-claude-bacg@lineamientos-dev-claude-bacg": true, "superpowers@superpowers-marketplace": true };
fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "bacg-dev.json"), JSON.stringify({ lineamientosDir: [process.env.ENTORNO, process.env.DEST] }, null, 2) + "\n");
'
echo "lineamientos-dev-claude-bacg habilitado; lineamientos: $ENTORNO (si existe) o $DEST"
