// Clasificación del RQ (M2): los valores internos de estado.yml siguen siendo spike|bounded|arquitectonico; la CLI
// acepta y muestra los nombres nuevos (Exploración, Acotado, Arquitectónico). Tabla de la sección 5 de la spec v4.

export const NOMBRES = { spike: 'Exploración', bounded: 'Acotado', arquitectonico: 'Arquitectónico' };

const ORDEN = ['spike', 'bounded', 'arquitectonico'];

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const EQUIVALENCIAS = new Map([
  ['spike', 'spike'], ['exploracion', 'spike'],
  ['bounded', 'bounded'], ['acotado', 'bounded'],
  ['arquitectonico', 'arquitectonico'], ['arquitectonica', 'arquitectonico'], ['architectural', 'arquitectonico'],
]);

/** Valor interno de una clasificación escrita con el valor interno o el nombre nuevo (sin tildes ni mayúsculas), o null. */
export function clasificacionDe(texto) {
  return EQUIVALENCIAS.get(normalizar(texto)) ?? null;
}

/** Nombre visible de un valor interno (o el mismo texto si no se conoce). */
export const nombreDe = (c) => NOMBRES[c] ?? String(c);

/** ¿Cuál pesa más? orden spike < bounded < arquitectonico: devuelve la más pesada de las dos. */
export function MAS_PESADA(a, b) {
  return ORDEN.indexOf(b) > ORDEN.indexOf(a) ? b : a;
}

/** Qué implica la clasificación `c` para el tipo `tipo` (`rq`|`bug`): líneas de la tabla de la sección 5. */
export function implicancias(c, tipo) {
  const l = [];
  if (tipo === 'bug' || tipo === 'fix') l.push('BUG: antes de diseñar, `systematic-debugging` y la sección `## Causa` en spec.md.');
  if (c === 'spike') {
    l.push('Diseño: la pregunta y la sonda (2-3 frases) en spec.md.');
    l.push('Sin ARQ ni plan; sin /prototype.');
    l.push('Termina al final de la sonda: el resultado es una recomendación; su código sólo se commitea bajo docs/rq/<código>/sonda/.');
  } else if (c === 'bounded') {
    l.push('Diseño: diseño corto en spec.md, con `## Tareas` como plan.');
    l.push('Sin ARQ; /prototype se ofrece si toca UI.');
  } else if (c === 'arquitectonico') {
    l.push('Diseño: spec completa en spec.md.');
    l.push('ARQ: `decision-arq` y ADR.');
    l.push('Plan: `writing-plans` y `plan.md`; /prototype se ofrece si toca UI.');
  }
  l.push('Aprobación del diseño (y del plan) con `aprobar 1`.');
  return l;
}
