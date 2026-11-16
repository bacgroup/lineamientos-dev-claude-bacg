// OK flexibles (PLG-DFF2, premisa 1). Sólo para `rq.mjs ok` con reglas 4.4: además de un mensaje u oración enteros,
// una frase del usuario vale como el tramo inicial de una oración cortado en una coma, si ese tramo es un OK explícito
// y lo que sigue no lo niega, lo frena, lo condiciona ni lo posterga:
//   "Sí, dale, el diseño está bien" → "Sí, dale".
//   No valen: "No, dale después", "Dale, pero esperá", "OK, pero mañana", "Dale, pero primero mostrame el mockup",
//   "Si funciona, avisame" (condicional), "Listo, ya corrí el script" o "Sí, el error aparece…" (acuses de recibo).
// aprobar, saltar, clasificacion, ejecucion, autonomia, el OK de PROD y la compuerta de Bash siguen pidiendo la oración
// entera. Los textos llegan normalizados (minúsculas, sin tildes ni puntuación), como los compara transcript.mjs.

// Verbos que por sí solos aprueban algo; un "sí", "ok", "listo" o "perfecto" sueltos no alcanzan (son acuses de recibo).
const RE_VERBO = /(?:^| )(?:dale|apruebo|aprobado|aprobada|aprobados|adelante|avanza|avanzad|avancen|segui|sigan|confirmo|confirmado|de acuerdo|hacelo|haganlo|procede|proceda)(?: |$)/;
const RE_NEGACION = /(?:^| )(?:no|ni|nunca|todavia|aun|espera|esperen|frena|frenen|para|pare|detene|stop|cancela|rechazo|rechazado)(?: |$)/;
// Lo que posterga o pone una condición antes: no es un OK para ahora.
const RE_CONDICION = /(?:^| )(?:pero|antes|primero|manana|despues|luego|mas tarde|otro dia|la semana que viene|cuando)(?: |$)/;

// El "si" condicional se distingue del "sí" afirmativo sólo por la tilde: se busca en el texto original. Un "si" sin
// tilde que quería decir "sí" hace que el tramo no cuente (falla cerrada: vale la oración entera).
const RE_SI_CONDICIONAL = /(?:^|[^\p{L}])si(?![\p{L}])/iu;
const condiciona = (crudo, t) => RE_CONDICION.test(t) || RE_SI_CONDICIONAL.test(String(crudo ?? ''));

function basico(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** ¿El tramo es un OK explícito: un verbo de aprobación, sin negación ni condición? */
export function tramoDeAprobacion(tramo, normalizar = basico) {
  const t = normalizar(tramo);
  return t !== '' && RE_VERBO.test(t) && !RE_NEGACION.test(t) && !condiciona(tramo, t);
}

/**
 * Tramos iniciales de una oración que valen como OK: cada prefijo cortado en una coma (sin la oración entera, que ya
 * cuenta por sí misma) que es un OK explícito, cuando el resto de la oración no niega, frena, condiciona ni posterga.
 */
export function tramosDeAprobacion(oracion, normalizar = basico) {
  const partes = String(oracion ?? '').split(',');
  const out = [];
  for (let k = 1; k < partes.length; k++) {
    const prefijo = partes.slice(0, k).join(',');
    const crudo = partes.slice(k).join(',');
    const resto = normalizar(crudo);
    if (tramoDeAprobacion(prefijo, normalizar) && !RE_NEGACION.test(resto) && !condiciona(crudo, resto)) out.push(prefijo.trim());
  }
  return out;
}
