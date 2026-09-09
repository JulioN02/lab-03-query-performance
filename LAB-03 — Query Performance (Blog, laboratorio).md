# LAB-03 — Query Performance: Rendimiento de Consultas

### El problema: la tabla creció y la consulta se volvió lenta

Una tabla de reportes comienza a crecer: 100 mil, 1 millón o incluso 10 millones de filas. La aplicación sigue funcionando, pero una consulta que antes respondía en milisegundos empieza a tardar varios segundos.

Para el usuario el diagnóstico es simple: *"el sistema está lento"*.

Pero el síntoma no revela la causa. ¿El problema está en la red? ¿En la aplicación? ¿En la base de datos? ¿Qué consulta está consumiendo realmente el tiempo?

La reacción habitual es modificar el código: cambiar el `SELECT`, agregar un `LIMIT` o buscar una optimización en la aplicación. Sin embargo, antes de cambiar una consulta es necesario entender **cómo PostgreSQL decidió ejecutarla**.

El mismo SQL puede comportarse de forma muy diferente cuando crece el volumen de datos. PostgreSQL puede elegir distintos caminos para ejecutarlo, y esa decisión determina cuánto trabajo debe realizar.

Por eso, antes de optimizar una consulta conviene preguntar:

> En vez de "¿qué está haciendo PostgreSQL?", preguntarse "¿qué está haciendo PostgreSQL **para responderlo**?".

### La herramienta: EXPLAIN ANALYZE

Para entender qué está ocurriendo dentro de la base de datos podemos utilizar `EXPLAIN ANALYZE` como una **brújula**: no solo muestra el plan que PostgreSQL considera, sino que **ejecuta la consulta** y permite observar lo que realmente ocurrió.

Esto permite pasar de una suposición como "la consulta está lenta" a **evidencia concreta** sobre el trabajo que está realizando PostgreSQL.

`EXPLAIN ANALYZE` permite identificar los principales pasos del plan de ejecución:

- **Scan** — cómo se accede a las filas.
- **Filtro** — cuántas filas cumplen la condición y cuántas se descartan.
- **Sort** — si PostgreSQL necesita ordenar los resultados.
- **Join** — cómo combina información de diferentes tablas.
- **Agregación** — cómo procesa operaciones como `GROUP BY` o `COUNT`.

También permite comparar:

- **Costo estimado vs. ejecución real** — lo que el planificador estimó frente a lo que ocurrió.
- **Filas estimadas vs. filas reales** — qué tan acertadas fueron las estimaciones.
- **Filas descartadas** — cuánto trabajo se realizó sobre datos que finalmente no se usaron.
- **Tiempo por nodo** — dónde se concentra el tiempo de ejecución.

> La información importante no es únicamente cuánto tarda la consulta, sino **qué trabajo** tuvo que realizar PostgreSQL para producir ese resultado.

### Cuando no existe un índice

Supongamos una tabla con 10 millones de filas y una consulta que busca los registros de una determinada `category`.

Si no existe un índice que permita localizar esas filas directamente, PostgreSQL usa un **Seq Scan (Sequential Scan)**: recorre la tabla y revisa las filas una por una.

Si solo algunas filas coinciden, las demás se descartan. Cuantas más filas tenga la tabla, más trabajo debe realizar PostgreSQL. Recorrer 100 mil filas puede ser aceptable; recorrer 10 millones puede hacer que la consulta sea lenta.

> El problema no es que PostgreSQL lea datos, es **cuánto trabajo** necesita realizar para encontrar los datos que realmente necesita.

Por eso, antes de crear un índice o modificar el SQL, el primer paso es observar el plan y comprobar qué está leyendo PostgreSQL, cuánto está descartando y dónde está empleando el tiempo.

### Posibles soluciones al problema

Una vez identificado el plan de ejecución, el objetivo es que PostgreSQL haga **menos trabajo**.

La solución no es simplemente crear un índice: su utilidad depende de los datos, de la consulta y de la cantidad de filas que cumplen el filtro. Además, los índices ocupan espacio y necesitan mantenimiento. Por eso cada alternativa debe evaluarse según el tipo de consulta y el plan que produce.

**Sin índice: Sequential Scan.** Cuando no existe un índice adecuado, PostgreSQL revisa toda la tabla, fila por fila, y conserva solo las que cumplen la condición. Este plan puede funcionar bien cuando la consulta necesita revisar gran parte de la tabla, pero puede ser lento si revisa muchas filas que después se descartan.

> Un Sequential Scan no siempre es malo; el problema aparece cuando revisa más filas de las necesarias.

**Índice B-Tree: localizar datos mediante una estructura ordenada.** El B-Tree es el índice más común de PostgreSQL. Ordena los valores y permite localizar las filas coincidentes sin recorrer toda la tabla. Su efectividad depende de la **selectividad**: funciona mejor cuando la consulta devuelve pocas filas; si devuelve una gran parte de la tabla, un Sequential Scan puede ser más eficiente.

> Un índice es útil cuando reduce el trabajo que realmente necesita realizar la consulta.

**Índices compuestos: adaptar el índice al patrón de consulta.** Las consultas de reportes suelen combinar filtros, agrupaciones y agregaciones. Un índice compuesto reúne varias columnas en una misma estructura para adaptarse mejor a ese patrón de acceso. El orden de las columnas es importante, porque determina qué consultas pueden aprovecharlo.

> El índice debe diseñarse según **cómo se consulta** la información, no solo según las columnas disponibles.

**Índices cubrientes: evitar volver a la tabla.** Un índice cubriente contiene todas las columnas que la consulta necesita. Esto permite que PostgreSQL use un **Index Only Scan** y obtenga los datos directamente del índice, sin acceder nuevamente a la tabla. Así se reduce el trabajo de entrada/salida, aunque el índice ocupa más espacio y requiere mayor mantenimiento.

> Un índice cubriente puede acelerar una consulta al evitar el acceso al heap, pero aumenta el coste de almacenamiento y mantenimiento.

**No existe un índice universalmente mejor.** La optimización depende del patrón de acceso y del plan de ejecución. Un índice puede mejorar una consulta, no producir cambios relevantes o incluso hacerla menos eficiente.

> La pregunta no es *qué índice agregar*, sino **qué trabajo realiza PostgreSQL** y qué estructura puede reducirlo.

### Repositorio y guía de uso

Esta publicación presenta los conceptos y las conclusiones de los experimentos de rendimiento realizados en PostgreSQL. Cada escenario incluye código ejecutable para medir las consultas, comparar sus planes y evaluar distintas estrategias de indexación.

Para consultar la implementación, las consultas y los resultados del laboratorio, accede al repositorio. Allí también encontrarás la guía de usuario para preparar el entorno, ejecutar los experimentos y reproducir las mediciones.

**🔗 [github.com/JulioN02/lab-03-query-performance](https://github.com/JulioN02/lab-03-query-performance)**

El repositorio contiene tanto los experimentos individuales como la documentación técnica necesaria para comprender qué se ejecutó, cómo se realizaron las mediciones y cómo interpretar los resultados obtenidos.

### Lecciones aprendidas

**Mide antes de optimizar.** Usa `EXPLAIN ANALYZE` para conocer el plan de ejecución, comparar estimaciones con resultados reales e identificar dónde se concentra el trabajo. La misma consulta puede generar planes distintos según los datos y las estadísticas.

> Si no mediste el problema, no sabes qué estás optimizando.

**Un índice es una inversión.** Un índice puede acelerar las consultas, pero ocupa espacio y aumenta el coste de las escrituras. Su utilidad depende de la selectividad y del tipo de consulta.

> No se trata de tener más índices, sino de elegir los necesarios y medir su impacto.

**El volumen de datos cambia el problema.** Una consulta que funciona bien con pocos datos puede volverse lenta cuando la tabla crece.

> Mide el rendimiento con un volumen de datos realista.

**Una medición aislada no es suficiente.** El tiempo de ejecución puede variar por la caché, la carga del servidor y otras condiciones del entorno. Repite las mediciones para obtener resultados confiables.

> Una medición muestra un resultado; varias muestran una tendencia.

**El índice correcto depende de la consulta.** No existe un índice ideal para todas las consultas: B-tree para búsquedas por igualdad o rangos, compuesto para consultas que filtran por varias columnas, cubriente para evitar accesos adicionales a la tabla.

### Conclusión

Los experimentos muestran que optimizar PostgreSQL no consiste en agregar índices indiscriminadamente. Primero hay que medir, después entender el plan de ejecución y finalmente elegir el índice adecuado según el patrón de acceso y la selectividad de los datos.

> Medir, entender, cambiar y volver a medir.
