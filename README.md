# LAB-03 — Rendimiento de Consultas (Query Performance)

**Laboratorio de Ingeniería**

> Hands-on lab: un experimento, no un producto. Laboratorio que demuestra con datos reales cómo PostgreSQL ejecuta una consulta sin índice y cómo cambia el plan al agregar distintos tipos de índice, midiendo la mejora con `EXPLAIN ANALYZE`.
> **Estado**: ✅ Completado — implementado, medido y verificado (4 experimentos + 4/4 tests + typecheck limpio).
> **Repositorio**: [github.com/JulioN02/lab-03-query-performance](https://github.com/JulioN02/lab-03-query-performance)

---

## Qué es este laboratorio

Es un **experimento de ingeniería medible** sobre rendimiento de consultas en PostgreSQL. La historia que cuenta:

1. Una tabla de reportes crece hasta **10 millones de filas**.
2. Una consulta que antes tomaba milisegundos ahora tarda **segundos**.
3. El cuello de botella **no está en el código de la aplicación** sino en el **plan de ejecución**: sin índice, PostgreSQL hace un *sequential scan* — lee la tabla completa (10M filas) y descarta 9M con el filtro; el costo crece linealmente con el tamaño de los datos (O(n)).
4. La solución no es adivinar, es **medir**: `EXPLAIN ANALYZE` muestra el plan real, el costo estimado vs. el tiempo real, y dónde se gasta el tiempo.
5. Con eso se decide **si** conviene un índice, **cuál** (B-tree simple, compuesto o cubriente) y **cuánto** mejora — números antes/después, no opiniones.

El laboratorio produce:
- **Mediciones reales**: 4 experimentos + tests, con evidencia capturada en `docs/output-*.txt`.
- **Dashboard interactivo**: explicación visual del tema con simulaciones animadas (`docs/dashboard/`).
- **Documentación**: este README (ficha técnica del repo) + notas pedagógicas.

---

## Arquitectura

```
┌────────────────────────────────────────────────────────────┐
│  CAPA DE EXPERIMENTOS (Node.js 26 + TypeScript)            │
│  Comandos npm: db:setup · db:load · exp:baseline ·         │
│  exp:explain · exp:index · exp:covering · test · typecheck │
│  Scripts secuenciales (comparten tabla e índices)          │
└──────────────────────────┬─────────────────────────────────┘
                           │ TCP localhost:55434
┌──────────────────────────▼─────────────────────────────────┐
│  CAPA DE DATOS (PostgreSQL 16 en Docker)                   │
│  Contenedor lab-03-pg · puerto 55434                       │
│  Credenciales fijas: postgres / lab                        │
│  Base: lab_query_performance                               │
│  Tabla: large_table (10.000.000 filas)                     │
│  Índices: se crean/destruyen durante los experimentos      │
└────────────────────────────────────────────────────────────┘
```

**Regla de oro**: los experimentos comparten la misma tabla y se ejecutan **secuencialmente** — nunca en paralelo, porque cada uno manipula el estado de los índices y la carga de datos.

---

## Tecnologías

| Tecnología | Rol en el lab | Por qué |
|---|---|---|
| **Node.js 26** | Ejecuta los scripts | Ejecuta TypeScript directamente (type-stripping), sin build ni transpilador |
| **TypeScript strict** | Tipa todo el código | Seguridad de tipos con `erasableSyntaxOnly` (compatible con type-stripping) |
| **PostgreSQL 16** | Motor de base de datos | Es el sujeto del experimento: queremos ver cómo ejecuta las consultas |
| **Docker + Compose** | Levanta PostgreSQL | Hace el lab **autocontenido**: cualquier persona lo corre sin configurar usuarios ni bases |
| **`pg`** (única dep. runtime) | Cliente PostgreSQL | Cliente oficial, minimalista, API por promesas |
| **node:test** | Framework de tests | Integrado en Node, sin dependencias adicionales |
| **HTML/CSS/JS puro** | Dashboard | Autocontenido, sin build ni CDN, se abre directo en el navegador |

**Decisión clave**: cero frameworks, cero build. El lab es un conjunto de scripts que se ejecutan tal cual, reproducible en cualquier máquina con Node + Docker.

---

## Patrón de diseño

### Conexión env-overridable con default Docker
Todo el código lee una configuración de conexión cuyos **defaults apuntan al contenedor Docker** (puerto 55434, `postgres`/`lab`). El lab funciona "out of the box" con Docker; quien prefiera su propio PostgreSQL puede sobreescribir cada parámetro con variables de entorno (`LAB_PGHOST`, `LAB_PGPORT`, `LAB_PGUSER`, `LAB_PGPASSWORD`, `LAB_PGDATABASE`).

### Datos deterministas
Los 10M de filas se generan con un patrón matemático fijo derivado del número de fila: cada categoría recibe **exactamente ~1M de filas** (10 categorías) y los valores son reproducibles corrida a corrida. Esto permite comparar mediciones entre corridas y controlar la **selectividad** del filtro (10 % de la tabla) — condición necesaria para la lección del lab.

### Carga eficiente con `generate_series`
La carga usa un único `INSERT ... SELECT generate_series` en SQL puro: PostgreSQL genera los 10M de filas internamente, sin round-trips al cliente. Resultado: **10M filas en ~4 minutos** (vs. más de 12 minutos a medias con inserción por lotes desde JavaScript).

### Ciclo de medición de cada experimento
1. **Preparar el estado** (crear/destruir el índice que corresponda; partir del estado base "sin índice en `category`").
2. **Ejecutar la consulta real** con `EXPLAIN ANALYZE` (muestra el plan y la ejecuta de verdad).
3. **Extraer métricas** del plan (tipo de scan, costo estimado, tiempo real, filas leídas/descartadas).
4. **Reportar** en consola con formato legible.
5. **Actualizar estadísticas** (`ANALYZE`) después de crear un índice — sin esto el planificador elegiría mal.

---

## Comandos

### Infraestructura

| Comando | Qué hace | Qué genera / cambia |
|---|---|---|
| `docker compose up -d --wait` | Levanta PostgreSQL 16 en el puerto 55434 y espera a que esté healthy | Contenedor `lab-03-pg` con la base `lab_query_performance` creada |
| `docker compose down` | Apaga el contenedor | Libera el puerto (los datos persisten en `./pgdata`) |
| `npm install` | Instala `pg` y las devDependencies | Carpeta `node_modules` |

### Base de datos

| Comando | Qué hace | Qué genera / cambia |
|---|---|---|
| `npm run db:setup` | Conecta a la base de mantenimiento, crea/elimina la base `lab_query_performance` (con `--fresh`), aplica el esquema SQL | La base + la tabla `large_table` (5 columnas) con estructura vacía |
| `npm run db:load` | Trunca la tabla si tiene datos y la llena con 10M filas deterministas; ejecuta `ANALYZE` | La tabla con 10.000.000 filas + estadísticas frescas del planificador |

### Experimentos (el corazón del lab)

| Comando | Qué hace | Qué genera / cambia |
|---|---|---|
| `npm run exp:baseline` | Ejecuta `SELECT * WHERE category=...` sobre 5 categorías **sin índice** en `category` | Muestra el plan `Seq Scan` (recorre 10M filas, descarta 9M) y el tiempo por categoría — demuestra el crecimiento lineal |
| `npm run exp:explain` | Ejecuta la consulta **antes** del índice (captura plan y tiempo), **crea un índice B-tree** en `category` (~45 s en 10M), hace `ANALYZE` y la ejecuta **después** | Crea `idx_large_table_category`; muestra el cambio de plan (Seq Scan → Bitmap) y la mejora medida |
| `npm run exp:index` | Elimina índices previos y mide una consulta de reporte (`GROUP BY` + `AVG` + `COUNT`) en 3 estados: sin índice, con índice simple, con índice compuesto `(category, value)` | Crea/destruye índices; muestra cómo el compuesto logra `Index Only Scan` y la mejora |
| `npm run exp:covering` | Mide el mismo reporte en 4 estados: sin índice, simple, compuesto y **cubriente** `(category, value, id)` | Crea/destruye índices; muestra el cubriente respondiendo sin volver a la tabla y el caso anti-intuitivo del índice simple que resulta más lento (0.8x) |

### Verificación

| Comando | Qué hace | Qué genera / cambia |
|---|---|---|
| `npm test` | Ejecuta 4 invariantes: (1) la tabla tiene datos, (2) sin índice → Seq Scan, (3) con índice → Index Scan/Bitmap, (4) el índice cubriente debe ser ≥ 2x más rápido | Resultado pass/fail de los 4 tests (usa índices temporales que crea y destruye) |
| `npm run typecheck` | Verifica tipos TypeScript sin compilar | Reporte de errores de tipos (limpio = 0 errores) |

### Evidencia

Para capturar cada salida como evidencia se redirige a un archivo:
```bash
npm run exp:baseline  > docs/output-01-baseline.txt
npm run exp:explain   > docs/output-02-explain.txt
npm run exp:index     > docs/output-03-index.txt
npm run exp:covering  > docs/output-04-covering.txt
npm test              > docs/output-test.txt
```
Los outputs son texto plano (gitignored, se regeneran).

---

## Cómo ejecutar

El lab es **autocontenido**: se clona, se levanta el contenedor y se ejecutan los comandos tal cual — sin configurar usuarios ni bases.

```bash
docker compose up -d --wait      # PostgreSQL 16 en localhost:55434
npm install                      # instala pg y devDependencies
npm run db:setup                 # crea la base lab_query_performance + schema
npm run db:load                  # carga 10M filas + ANALYZE (~4 min)

npm run exp:baseline             # Exp 1: consulta sin índice (Seq Scan)
npm run exp:explain              # Exp 2: EXPLAIN ANALYZE antes/después del B-tree
npm run exp:index                # Exp 3: índice compuesto + re-medición
npm run exp:covering             # Exp 4: índice cubriente

npm test                         # invariantes con node:test
npm run typecheck                # tsc --noEmit (TS strict)
```

> **Importante**: correr los experimentos **de a uno, secuencialmente** — comparten tablas e índices; lanzarlos en paralelo contamina las mediciones.

### Usar un PostgreSQL local en vez de Docker (opcional)

```bash
export LAB_PGHOST=/var/run/postgresql
export LAB_PGPORT=5432
export LAB_PGUSER=tu_usuario
npm run db:setup     # y anteponga las mismas envs a cada npm run exp:*
```

| Variable | Default (Docker) | Descripción |
|---|---|---|
| `LAB_PGHOST` | `localhost` | Host o socket del servidor |
| `LAB_PGPORT` | `55434` | Puerto (Docker del lab) |
| `LAB_PGUSER` | `postgres` | Usuario |
| `LAB_PGPASSWORD` | `lab` | Password |

---

## Cómo leer el plan de ejecución (resumen)

`EXPLAIN ANALYZE` muestra el plan que el planificador **eligió** (estimaciones) y el resultado de **ejecutar** la consulta (números reales). Se lee en 4 capas:

### Anatomía de un nodo del plan

| Capa | Qué dice | En un `Seq Scan` típico |
|---|---|---|
| **Método de acceso** | Qué operación se ejecuta y sobre qué tabla | `Seq Scan on large_table` (lee la tabla de punta a punta) |
| **Estimaciones** | `cost=a..b` (costo abstracto, para comparar planes), `rows=N` (filas estimadas de salida), `width` (bytes por fila) | `cost=0.00..211385.14 rows=1004684 width=38` |
| **Números reales** | `actual time=a..b` (ms: a = hasta la primera fila, b = hasta la última → duración del nodo), `rows=N` reales, `loops=N` (si > 1, multiplicar el tiempo) | `actual time=20.620..4799.594 rows=1000000 loops=1` |
| **Detalles del filtro** | `Filter` (criterio aplicado a cada fila) y `Rows Removed by Filter` (filas leídas y descartadas) | `Filter: category = 'Electronics'` · `Rows Removed: 9000000` |

Los tiempos globales (`Planning Time`, `Execution Time`) cierran el plan: el primero es lo que tardó el planificador en *elegir*; el segundo, la ejecución total real.

### Cómo se leen las jerarquías

- **De adentro hacia afuera**: el nodo más indentado se ejecuta primero.
- Ejemplo típico con índice: `Bitmap Index Scan` (adentro) usa el índice para ubicar filas candidatas; `Bitmap Heap Scan` (afuera) va a la tabla a traerlas. Un `Index Only Scan` responde **todo desde el índice**, sin volver a la tabla — el escenario ideal para reportes.

### Señales de alerta

| Si ves... | Significa |
|---|---|
| `Seq Scan` sobre tabla grande | Sin índice útil — está leyendo todo. Primer sospechoso de lentitud |
| `Rows Removed by Filter` alto | Se está leyendo muchísimo para quedarse con poco — filtro no indexado |
| `cost`/`rows` estimados muy distintos de los reales | Estadísticas viejas → ejecutar `ANALYZE` |
| `Index Scan` / `Bitmap Index Scan` | El índice se está usando |
| `Index Only Scan` | El índice cubre la consulta — escenario ideal |

### Checklist de 4 pasos

1. Mire el nodo de scan (el más interno): ¿`Seq Scan`, `Index Scan` o `Index Only Scan`? Ahí está el 80 % del diagnóstico.
2. Compare estimado vs. real (`rows=`): si difieren mucho → `ANALYZE`.
3. Mire `Rows Removed by Filter`: número alto = se está descartando muchísimo = falta índice o no cubre.
4. Tome el `actual time` del nodo de scan (fin − inicio): es el tiempo real del cuello de botella y el que usan los experimentos para medir antes/después.

---

## Resultados medidos (evidencia real)

Tabla `large_table` con **10.000.000 de filas** (~1M por categoría) en `lab_query_performance`. PostgreSQL 16, Node 26 + `pg`. Cada experimento ejecuta `EXPLAIN ANALYZE` sobre los datos reales y captura su salida en `docs/output-*.txt`. `ANALYZE` después de cada índice.

| Escenario | Consulta | Sin índice | Con índice (mejor) | Tiempos (ms) | Mejora | Resultado |
|---|---|---|---|---|---|---|
| 01 · Línea base (SEQ SCAN) ❌ | `SELECT * WHERE category='Electronics'` | Seq Scan | — | 4778.97–5936.61 | — | Examina 10M, devuelve 1M · O(n) |
| 02 · B-tree simple ⚠️ 1.3x | `SELECT * WHERE category='Electronics'` | Seq Scan | Bitmap Heap Scan | 5547.21 → 4399.28 | **1.3x** | 20.7 % reducción · baja selectividad: 1M/10M = 10 % |
| 03 · Compuesto ✅ 4.6x | `SELECT category, AVG(value), COUNT(*) … GROUP BY` | Seq Scan | Index Only Scan (category, value) | 1917.99 → 414.01 | **4.6x** | simple 1.0x · compuesto 4.6x · Heap Fetches: 71010 |
| 04 · Cubriente ✅ 2.9x | reporte + `SELECT category, value` | Seq Scan | Index Only Scan (category, value, id) | 2531.10 → 866.52 | **2.9x** | simple 0.8x (más lento) · cubriente responde sin heap |
| Tests ✅ 4/4 | `node --test` (invariantes) | Seq Scan | Index Only Scan (category, value) | 5175.84 → 951.10 | **5.4x** | invariante ≥ 2x cumplida |

**Tests**: 4/4 pass — invariantes con `node:test`: (1) tabla con datos, (2) sin índice → Seq Scan, (3) con índice → Index Scan/Bitmap, (4) índice cubriente ≥ 2x más rápido (corrida capturada: 5175.84 → 951.10 ms = 5.4x). **Typecheck**: limpio.

**Hallazgo central**: el mismo índice B-tree dio **1.3x** para `SELECT *` (exp 2, selectividad baja) y **4.6x / 2.9x** para el reporte agregado (exp 3-4, índice compuesto/cubriente). El índice correcto surge de leer la consulta, no "por si acaso".

---

## Estructura del repositorio

```
lab-03-query-performance/
├── package.json              # scripts: exp:*, db:*, test, typecheck
├── tsconfig.json             # TS strict + erasableSyntaxOnly (type-stripping)
├── docker-compose.yml        # postgres:16 en localhost:55434 (autocontenido)
├── .gitignore                # node_modules · docs/output-*.txt (evidencia regenerable)
├── migrations/
│   └── 001_schema.sql        # large_table (sin índice en category, a propósito)
├── src/
│   ├── db.ts                 # pool env-overridable + explainAnalyze + queryWithTiming
│   ├── setup.ts              # crea/dropea la base y aplica la migración (--fresh)
│   ├── load-data.ts          # carga 10M filas con generate_series + ANALYZE
│   ├── util.ts               # extractMetrics + comparaciones + reporter
│   ├── exp-01-baseline.ts    # Exp 1 · consulta sin índice (Seq Scan)
│   ├── exp-02-explain.ts     # Exp 2 · EXPLAIN ANALYZE antes/después del B-tree
│   ├── exp-03-index.ts       # Exp 3 · simple → compuesto → cubriente (reporte)
│   └── exp-04-covering.ts    # Exp 4 · compuesto/cubriente (reporte + SELECT)
├── tests/
│   └── perf.test.ts          # 4 invariantes de rendimiento (node:test)
└── docs/
    ├── output-01-baseline.txt # evidencia capturada (gitignored, se regenera)
    ├── output-02-explain.txt
    ├── output-03-index.txt
    ├── output-04-covering.txt
    ├── output-test.txt
    └── dashboard/            # 🖥️ dashboard visual del laboratorio
        ├── index.html
        ├── app.js
        └── style.css
```

---

## Notas y troubleshooting

- **Error de conexión**: primero `docker compose up -d --wait` y verifique que el contenedor esté healthy. Si se usa PG local, revise las variables `LAB_PG*`.
- **`ANALYZE` obligatorio** tras cargar datos y tras crear índices: sin estadísticas frescas el planificador puede elegir mal.
- **Cache frío**: la primera corrida de una consulta es la más lenta. Descártela y repita 2-3 veces; reporte rangos.
- **`node --test` sin argumentos**: pasar `tests/` como ruta falla; el script `test` ya lo invoca sin argumentos.
- **Los experimentos son secuenciales**: comparten tablas e índices — nunca en paralelo.
- **Crear el índice en 10M tarda ~45 s**: el índice es inversión con costo (escrituras + disco).
- **El índice simple no es bala de plata**: con selectividad del 10 % la mejora fue 1.3x / 1.0x / 0.8x según el experimento. Si el índice "no funciona", leé el plan: el problema es la selectividad, no el índice.
- **`docs/output-*.txt` son gitignored**: no se versionan; se regeneran ejecutando los experimentos.