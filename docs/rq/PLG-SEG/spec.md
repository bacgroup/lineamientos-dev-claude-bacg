# PLG-SEG · Checklist de seguridad de aplicaciones (OWASP) con referencia ISO 27001 y SOC 2
Tipo: RQ · Clasificación: Acotado · Repos: lineamientos-dev-claude-bacg
## Qué / Síntoma
`general/seguridad.md` cubre secretos, RLS, PROD y los límites de las compuertas, pero no dice qué revisar en el código de una app: permisos, entradas, sesiones, dependencias, datos personales. La revisión de la etapa 3 y el futuro revisor del PR (PLG-PRREV) no tienen un criterio común de seguridad.
## Por qué / Esperado vs. actual
Pedido del usuario (18/11): que la calidad sea el estándar, tomando SOC 2 e ISO 27001 como **referencia de calidad** (no certificación). Esperado: un checklist corto, accionable y verificable en un diff, con cada punto atado a su control de referencia; la revisión lo aplica. Actual: depende del criterio de cada revisor.
## Alcance (dentro / fuera)
Dentro: sección "Checklist de aplicaciones" en `general/seguridad.md`; `revisor-rq` lo aplica a lo que el diff toca; `ciclo-rq` sección 5 lo nombra.
Fuera: evidencia exportable para auditoría, políticas de la organización, separación de funciones en PROD (decisión del 18/11: referencia, no auditoría); el revisor del PR (PLG-PRREV, que lo reutiliza).
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: no aplica — documentación de criterios, sin contratos, datos ni despliegue
## Criterio de aceptación → flujo E2E que lo prueba
1. `general/seguridad.md` tiene el checklist con 10 a 14 puntos, cada uno con "qué mirar en el diff" y su referencia (OWASP, ISO 27001 Anexo A, SOC 2 CC) → test de manifiestos/contenido que verifica la sección y que cada punto tiene referencia.
2. `revisor-rq` incluye la pasada de seguridad de aplicación con el checklist, sólo sobre lo que el diff toca → mismo test (el agente nombra `general/seguridad.md`).

## Diseño
- **Checklist** (una línea por punto, formato: punto → qué mirar en el diff → referencia):
  1. Control de acceso en el servidor (cada endpoint/acción valida rol y dueño del dato; nada confiado al front) → OWASP A01 · ISO 8.3 · SOC CC6.1
  2. Validación y codificación de entradas (consultas parametrizadas, sin `eval`/HTML crudo) → A03 · ISO 8.28
  3. Autenticación y sesiones (expiración, logout, sin tokens en URL ni en localStorage cuando hay alternativa) → A07 · ISO 8.5 · CC6.1
  4. Secretos (remite a la sección Secretos) → A02 · ISO 8.24 · CC6.1
  5. Datos personales y logs (sin PII, tokens ni contraseñas en logs ni mensajes de error) → A09 · ISO 8.11, 8.12, 8.15 · CC6.7
  6. Errores (mensajes genéricos al usuario, detalle sólo en el log; sin errores tragados) → A05 · ISO 8.28
  7. Dependencias (versión fijada, sin paquetes abandonados o con CVE conocida; lockfile commiteado) → A06 · ISO 8.8 · CC7.1
  8. Configuración segura (CORS acotado, cabeceras, debug apagado en PROD) → A05 · ISO 8.9
  9. Límites y abuso (rate limit o paginación en endpoints públicos y de login; tamaño de archivos) → A04 · ISO 8.6
  10. Integridad de datos y archivos (subidas con tipo y tamaño validados; integridad de webhooks con firma) → A08 · ISO 8.28
  11. Peticiones salientes (SSRF: URLs del usuario contra lista permitida) → A10 · ISO 8.20
  12. Separación de entornos y datos de prueba (sin datos reales en tests ni en DEV) → ISO 8.31, 8.33 · CC8.1
  13. Trazabilidad del cambio (RQ, revisión y aprobación registrados: ya lo da el ciclo) → ISO 8.32 · CC8.1
- **Uso:** la revisión aplica sólo los puntos que el diff toca y reporta "no aplica" en bloque para el resto (no se rellena). Un hallazgo en 1, 2, 3, 4 o 5 es **crítico** (lo usará PLG-PRREV para bloquear).
- `revisor-rq` suma el checklist a su pasada; no se agrega un cuarto subagente (costo).
- Nota en el checklist: SOC 2 e ISO 27001 son referencia de calidad; el plugin no produce evidencia de auditoría.

## Tareas
1. Test rojo: el contenido de `general/seguridad.md` tiene la sección y cada punto lleva referencia; `revisor-rq.md` nombra el checklist.
2. Escribir la sección en `general/seguridad.md`.
3. `agents/revisor-rq.md`: pasada de seguridad de aplicación con el checklist.
4. `ciclo-rq` sección 5: una línea que nombra el checklist.
5. Suite completa en verde.
