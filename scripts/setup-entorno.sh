#!/usr/bin/env bash
# Setup de un entorno de Claude Code (nube o máquina nueva) para un proyecto de BACG.
# Deja la copia de trabajo de los lineamientos donde el plugin la busca por defecto.
# Uso en el "setup script" del entorno: bash <(curl ...) o copiar este contenido tal cual.
set -euo pipefail
DEST="${BACG_LINEAMIENTOS_DIR:-$HOME/lineamientos-bacg}"
if [ -d "$DEST/.git" ]; then
  git -C "$DEST" pull --ff-only --quiet || echo "aviso: no pude actualizar $DEST"
else
  git clone --depth 1 https://github.com/bacgroup/lineamientos-dev-claude-bacg "$DEST"
fi
node --version | grep -qE '^v(2[2-9]|[3-9][0-9])' || echo "aviso: el plugin necesita Node 22 o más"
echo "lineamientos-bacg listo en $DEST"
