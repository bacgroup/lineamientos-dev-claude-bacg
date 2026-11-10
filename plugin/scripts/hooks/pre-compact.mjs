// Entrada del hook PreCompact (PLG-CTX). Su salida estándar es texto plano: Claude Code la usa como instrucciones
// para el resumen de la compactación. Sin imports estáticos; si algo falla, no imprime nada y la compactación sigue.

let texto = '';
try {
  process.stdin.setEncoding('utf8');
  for await (const trozo of process.stdin) texto += trozo;
} catch {
  // stdin ilegible
}

try {
  const { handler } = await import('../lib/hooks/pre-compact.mjs');
  const salida = await handler(JSON.parse(texto));
  if (salida) process.stdout.write(salida);
} catch {
  // sin instrucciones: la compactación usa las suyas
}
