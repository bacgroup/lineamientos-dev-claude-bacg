// Evidencia del diseño de UI (PLG-DFF2, premisa 4 y cambios 1 y 2): con reglas 4.4, la sección ## Diseño de spec.md
// tiene que traer el recorrido del usuario, el mockup, lo que se leyó de referencia y la paridad con lo que se reemplaza.
// La compuerta de edición de UI lo exige antes del primer cambio, y `verificar --local` pide las capturas que lo prueban.
import fs from 'node:fs';
import path from 'node:path';
import { RE_ITEM, leerSpec, seccion } from './spec.mjs';

const RE_FIGMA = /https?:\/\/(?:www\.)?figma\.com\/\S+/i;
const EXT_MOCKUP = /\.(?:html?|png|jpe?g|svg|webp|pdf)$/i;

export const ANCHOS_CAPTURA = [390, 768, 1280];

/** Subsección `### <titulo>` dentro de `## Diseño` (la evidencia vale sólo ahí), o null. */
function subseccion(texto, titulo) {
  const diseno = seccion(texto, 2, 'Dise[ñn]o\\b');
  return diseno ? seccion(diseno, 3, `${titulo}\\b`) : null;
}

const conTexto = (ls) => ls.some((l) => l.trim() !== '');

function mockupsEnDisco(raiz, codigo) {
  try {
    return fs.readdirSync(path.join(raiz, 'docs', 'rq', codigo, 'mockups')).some((f) => EXT_MOCKUP.test(f));
  } catch {
    return false;
  }
}

/** Lo que le falta a ## Diseño para un cambio de UI con reglas 4.4 ([] si está completo). */
export function faltasDisenoUi(raiz, codigo) {
  const spec = leerSpec(raiz, codigo);
  const dir = `docs/rq/${codigo}`;
  const falta = [];
  const journey = subseccion(spec, 'Journey');
  if (!journey || journey.filter((l) => RE_ITEM.test(l)).length < 3) {
    falta.push('### Journey: el recorrido del usuario paso a paso (rol, pantalla, decisión y datos), 3 pasos o más');
  }
  const mockups = subseccion(spec, 'Mockups');
  if (!mockups || !(RE_FIGMA.test(mockups.join('\n')) || mockupsEnDisco(raiz, codigo))) {
    falta.push(`### Mockups: un mockup navegable del journey en ${dir}/mockups/ (HTML, PNG o SVG) o el link de Figma`);
  }
  const refs = subseccion(spec, 'Referencias le[ií]das');
  if (!refs || !conTexto(refs)) falta.push('### Referencias leídas: pantalla o componente de referencia leído entero (o "no aplica — motivo")');
  const paridad = subseccion(spec, 'Paridad');
  if (!paridad || !conTexto(paridad)) falta.push('### Paridad: qué hace hoy el flujo que se reemplaza o con el que convive y dónde queda en el nuevo (o "no aplica — motivo")');
  return falta;
}

/** ¿Hace falta una captura de referencia (ref-*.png)? Sí si ### Referencias leídas nombra algo y no dice "no aplica". */
export function refExigida(raiz, codigo) {
  const refs = subseccion(leerSpec(raiz, codigo), 'Referencias le[ií]das');
  return Boolean(refs && conTexto(refs) && !/no aplica/i.test(refs.join(' ')));
}

/** Qué le falta a un juego de capturas de la verificación local con UI: anchos y referencia. */
export function faltasCapturas(rutas, conRef) {
  const nombres = rutas.map((r) => path.basename(r));
  const falta = ANCHOS_CAPTURA.filter((a) => !nombres.some((n) => new RegExp(`(?:^|\\D)${a}(?:\\D|$)`).test(n) && !/^ref-/i.test(n)))
    .map((a) => `una captura a ${a} px (el ancho en el nombre: <pantalla>-${a}.png)`);
  if (conRef && !nombres.some((n) => /^ref-/i.test(n))) falta.push('la captura de la pantalla de referencia (ref-<pantalla>-<ancho>.png) para comparar lado a lado');
  return falta;
}
