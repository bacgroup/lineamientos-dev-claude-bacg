# PLG-DFF3 · Paridad ejecutable automática (P-1, P-2)
Tipo: RQ · Clasificación: Arquitectónico · Repos: bacgroup/lineamientos-dev-claude-bacg (se porta a nkick25/dev-fullflow)

## Qué
Que la paridad entre un flujo viejo (V1) y el que lo reemplaza (V2) se pruebe ejecutando y no leyendo. Hoy, con la 4.4, la `### Paridad` es una tabla que escribe el agente. En R-MOD-V2 esa tabla decía "Igual" a nivel de bloque, y el usuario encontró al menos 12 faltas (L1 a L10 y U8).

## Por qué
- `retrabajo-r-mod-v2.md` §2.3 dice: "la paridad que se probó ejecutando salió bien (SQL, 0 diferencias); la que se declaró leyendo falló".
- La lección 18 pide comparar el mismo caso en los dos flujos y lo visible: el texto de las tarjetas y los totales.

## Alcance (dentro / fuera)
**Dentro**
- `rq.mjs paridad --desde <componente V1>` arma el inventario automático:
  - imports de V1 (funciones de `lib`, componentes compartidos);
  - árbol de accesibilidad de la pantalla V1 levantada.
- `docs/rq/<código>/paridad.yml`.
- Compuertas por etapa.
- Control de reuso real (V2 importa lo que la fila dice que reusa).
- Plantilla de E2E "mismo caso en V1 y V2".

**Fuera**
- Recorrer V1 haciendo clic para descubrir modales y pasos posteriores: tiene efectos secundarios y se declaran a mano.
- P-19 (uso real desde PROD).
- Stacks que no son JS/TS en el análisis estático: Odoo XML y Python entran sólo por el árbol de accesibilidad.

## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: amerita — subsistema nuevo (navegador headless en la CLI), contrato nuevo (paridad.yml) y más de 10 archivos.

## Criterio de aceptación → flujo E2E que lo prueba
(se completa en el diseño)
