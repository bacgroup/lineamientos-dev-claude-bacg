// OK flexibles (PLG-DFF2, premisa 1). Además de un mensaje u oración enteros, una frase del usuario vale como el tramo
// inicial de una oración, cortado en una coma, si trae un verbo de aprobación y ni ese tramo ni lo que sigue lo niegan o
// lo frenan ni lo postergan: "Sí, dale, el diseño está bien" registra "Sí, dale"; "No, dale después", "Dale, pero
// esperá" y "OK, pero mañana" no.
// Los textos llegan normalizados (minúsculas, sin tildes ni puntuación), como los compara transcript.mjs.

const RE_APROBACION = /(?:^| )(?:ok|okay|okey|dale|apruebo|aprobado|aprobada|aprobados|adelante|avanza|avanzad|avancen|segui|sigue|sigan|confirmo|confirmado|de acuerdo|si|listo|perfecto|va|vamos|hacelo|procede|proceda)(?: |$)/;
const RE_NEGACION = /(?:^| )(?:no|ni|nunca|todavia|aun|espera|esperen|frena|frenen|detene|stop|cancela|rechazo|rechazado)(?: |$)/;
// Lo que sigue al tramo lo posterga ("OK, pero mañana"): no es un OK para ahora.
const RE_POSTERGA = /(?:^| )(?:manana|despues|luego|mas tarde|otro dia|la semana que viene|cuando)(?: |$)/;

/** ¿El tramo (normalizado o no) aprueba sin negar? */
export function tramoDeAprobacion(tramo, normalizar = basico) {
  const t = normalizar(tramo);
  return t !== '' && RE_APROBACION.test(t) && !RE_NEGACION.test(t);
}

function basico(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Tramos iniciales de una oración que valen como OK: cada prefijo cortado en una coma (sin la oración entera, que ya
 * cuenta por sí misma) que aprueba sin negar, cuando el resto de la oración tampoco niega ni frena.
 */
export function tramosDeAprobacion(oracion, normalizar = basico) {
  const partes = String(oracion ?? '').split(',');
  const out = [];
  for (let k = 1; k < partes.length; k++) {
    const prefijo = partes.slice(0, k).join(',');
    const resto = partes.slice(k).join(',');
    const r = normalizar(resto);
    if (tramoDeAprobacion(prefijo, normalizar) && !RE_NEGACION.test(r) && !RE_POSTERGA.test(r)) out.push(prefijo.trim());
  }
  return out;
}
