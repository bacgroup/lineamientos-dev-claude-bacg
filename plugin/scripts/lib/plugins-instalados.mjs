// Plugins instalados en la cuenta (PLG-CLOUD, hallazgo 7). Además de installed_plugins.json (lo que instala /plugin),
// cuentan los sincronizados desde claude.ai: en Claude Code en la nube y en Cowork vienen en
// <config>/plugins/synced/<org>_<cuenta>/<id>/.claude-plugin/plugin.json y no figuran en installed_plugins.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dirConfigClaude } from './sesiones.mjs';

const leerJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * { ids, nombres, ilegible, tiene(id) } o null si no hay nada que leer (ilegible: installed_plugins.json existe y no se
 * entiende) (no se sabe qué está instalado). `tiene` acepta un id
 * completo ("superpowers@superpowers-marketplace") y lo da por instalado si está ese id o un plugin sincronizado con
 * ese nombre (el marketplace de claude.ai no es el mismo).
 */
export function pluginsInstalados({ env = process.env, home = os.homedir() } = {}) {
  const base = path.join(dirConfigClaude({ env, home }), 'plugins');
  const ids = new Set();
  const nombres = new Set();
  let leido = false;
  const archivo = path.join(base, 'installed_plugins.json');
  const inst = leerJson(archivo);
  // PLG-DEPS: si el archivo existe pero no se entiende (corrupto u otro formato), lo instalado no es confiable.
  const ilegible = fs.existsSync(archivo) && !(inst && typeof inst.plugins === 'object' && inst.plugins !== null && !Array.isArray(inst.plugins));
  if (inst && !ilegible) {
    leido = true;
    for (const id of Object.keys(inst.plugins ?? {})) {
      ids.add(id);
      nombres.add(id.split('@')[0]);
    }
  }
  let cuentas = [];
  try {
    cuentas = fs.readdirSync(path.join(base, 'synced'), { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    // sin plugins sincronizados
  }
  for (const c of cuentas) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(path.join(base, 'synced', c.name), { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const d of dirs) {
      const m = leerJson(path.join(base, 'synced', c.name, d.name, '.claude-plugin', 'plugin.json'));
      if (typeof m?.name === 'string' && m.name) {
        leido = true;
        nombres.add(m.name);
      }
    }
  }
  if (!leido) return null;
  return { ids, nombres, ilegible, tiene: (id) => ids.has(id) || nombres.has(String(id).split('@')[0]) };
}
