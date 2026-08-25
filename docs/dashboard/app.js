/* ================= LAB-03 · Rendimiento de Consultas — app.js =================
   Tabs de código + 6 simulaciones animadas (sim-a … sim-f), una por sección:
     sim-a  (01)  qué sucede SIN EXPLAIN ANALYZE     → scan doloroso (10M leídas, 9M descartadas)
     sim-b  (02)  el plan anotado (Seq Scan)          → nodo a nodo, con KPIs
     sim-c  (03b) B-tree antes/después                → Seq Scan → Bitmap (lección de selectividad)
     sim-d  (03c) índice compuesto (reporte GROUP BY) → barras: 1917.99 → 1856.86 → 414.01
     sim-e  (03d) índice cubriente                    → barras A/B/C/D + bonus 0.8x
     sim-f  (04)  comparación de las 4 formas         → tarjetas A/B/C/D lado a lado
   Los veredictos usan los tokens de color del CSS (good / bad / warn).
   Los números que se muestran coinciden verbatim con el canon del laboratorio.
============================================================================ */

/* ================= helpers ================= */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setTxt(host, html) {
  const t = $(".sim-txt", host);
  if (t) t.innerHTML = html;
}
function setStat(host, sel, val) {
  const el = $(sel, host);
  if (el) el.textContent = val;
}
function setPhase(scope, phase, variant) {
  $$(".cline", scope).forEach((l) => l.classList.remove("run", "win", "lose"));
  if (!phase) return;
  $$(`.cline[data-phase="${phase}"]`, scope).forEach((l) =>
    l.classList.add(variant || "run")
  );
}
function verdict(host, cls, html) {
  const v = $(".sol-verdict", host);
  if (!v) return;
  v.hidden = false;
  v.className = "sol-verdict " + cls;
  v.innerHTML = html;
}
/* rango de ejecución del runner: el article si existe, si no la sección completa */
const scopeOf = (host) => host.closest("article") || host.closest("section") || host;

/* —— bloques del heap (sims de escaneo) —— */
function buildBlocks(host, n, label = "1M") {
  const row = $(".sim-blocks", host);
  row.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const b = document.createElement("div");
    b.className = "hblk";
    b.textContent = label;
    row.appendChild(b);
  }
  return $$(".hblk", $(".sim-blocks", host));
}
function setBlock(host, i, cls) {
  const b = $$(".hblk", $(".sim-blocks", host))[i];
  if (b) b.className = "hblk " + cls;
}

/* —— líneas del plan anotado (sim-b) —— */
function setPlan(host, upto) {
  $$(".pline", host).forEach((p) => {
    const idx = parseInt(p.dataset.phase, 10);
    p.classList.toggle("on", !isNaN(idx) && idx <= upto);
  });
}

/* —— barras de tiempos (sims d / e) —— */
function buildBars(host, rows) {
  const el = $(".sim-bars", host);
  el.innerHTML = "";
  rows.forEach((r) => {
    const bar = document.createElement("div");
    bar.className = "bar " + r.cls;
    bar.innerHTML =
      `<span class="b-label">${r.label}</span>` +
      `<span class="b-track"><span class="b-fill"></span></span>` +
      `<span class="b-val"><span class="bx">${r.badge}</span> ${r.val}</span>`;
    el.appendChild(bar);
  });
}
function setBar(host, i, pct) {
  const bar = $$(".sim-bars .bar", host)[i];
  if (bar) $(".b-fill", bar).style.width = pct + "%";
}

/* —— tarjetas de las 4 formas (sim-f) —— */
function setForm(host, caseName, cls) {
  const card = $(`.form-card[data-case="${caseName}"]`, host);
  if (!card) return;
  ["bad", "warn", "good", "info"].forEach((c) => card.classList.remove(c));
  card.classList.add("on", cls);
}
const resetForms = (host) =>
  $$(".form-card", host).forEach((c) => c.classList.remove("on", "bad", "warn", "good", "info"));

/* ================= SIMULACIONES ================= */
const simRunners = {
  /* (a) 01 · qué sucede SIN EXPLAIN ANALYZE — scan doloroso */
  "sim-a": async function (host) {
    const scope = scopeOf(host);
    buildBlocks(host, 10, "1M");
    const btn = $(".sim-run", host);
    btn.disabled = true;
    setPhase(scope, "sql");

    setTxt(host, "▶ La consulta se lanza a ciegas — sin EXPLAIN ANALYZE no hay plan a la vista. PostgreSQL va a barrer <b>TODA la tabla</b>…");
    await sleep(450);
    for (let i = 0; i < 10; i++) {
      setBlock(host, i, "read");
      setTxt(host, `Leyendo bloque <b>${i + 1}/10</b> (~1M filas)…`);
      await sleep(150);
      if (i === 5) {
        setBlock(host, i, "hit");
        setTxt(host, "Este bloque <b>coincide</b> con 'Electronics' (~1M filas) → se conserva.");
      } else {
        setBlock(host, i, "miss");
        setTxt(host, `Filtro: este bloque <b>no coincide</b> → se descarta.`);
      }
      await sleep(100);
    }
    setStat(host, ".sim-read", "10,000,000");
    setStat(host, ".sim-removed", "9,000,000");
    setStat(host, ".sim-rows", "1,000,000");
    setStat(host, ".sim-time", "≈ 5.5 s");
    setTxt(host, "Resultado: <b>10.000.000</b> leídas · <b>9.000.000</b> descartadas · <b>1.000.000</b> devueltas — en <b>≈ 5.5 s</b>, y nadie vio por qué.");
    verdict(
      host,
      "bad",
      "❌ SIN VISIBILIDAD — la consulta lee <b>10M</b> filas y solo devuelve <b>1M</b><span class='sub'>Sin EXPLAIN ANALYZE nadie ve el plan: PostgreSQL leyó las 10.000.000 de filas una por una (Rows Removed by Filter: 9000000) y tardó ~5.5 s. La única señal fue la queja del usuario: «el sistema anda lento».</span>"
    );
    btn.disabled = false;
  },

  /* (b) 02 · el plan anotado, nodo a nodo */
  "sim-b": async function (host) {
    const scope = scopeOf(host);
    buildBlocks(host, 10, "1M");
    const btn = $(".sim-run", host);
    btn.disabled = true;
    setPlan(host, -1);
    setPhase(scope, "fn", "run");

    setTxt(host, "▶ La función <b>explainAnalyze</b> ejecuta la consulta de verdad y devuelve el plan…");
    await sleep(500);

    setPlan(host, 0);
    setTxt(host, "<b>Seq Scan on large_table</b> — lee la tabla completa (cost=0.00..211385.14 · rows estimadas 1004684)…");
    await sleep(400);
    for (let i = 0; i < 10; i++) {
      setBlock(host, i, "read");
      setTxt(host, `Leyendo bloque <b>${i + 1}/10</b> (actual time 20.620…4799.594)…`);
      await sleep(85);
    }

    setPlan(host, 1);
    setTxt(host, "<b>Filter:</b> ((category)::text = 'Electronics'::text) — se evalúa sobre cada fila…");
    await sleep(400);

    setPlan(host, 2);
    setTxt(host, "<b>Rows Removed by Filter: 9000000</b> — 9M filas leídas y descartadas; solo ~1M pasan…");
    await sleep(500);
    for (let i = 0; i < 10; i++) setBlock(host, i, i === 5 ? "hit" : "miss");

    setPlan(host, 4);
    setTxt(host, "<b>Planning Time: 2.154 ms</b> — el planificador tardó poquísimo en decidir el plan…");
    await sleep(450);

    setPlan(host, 5);
    setTxt(host, "<b>Execution Time: 5037.520 ms</b> — acá se va el tiempo: el escaneo de la tabla.");
    await sleep(600);

    setStat(host, ".sim-read", "10,000,000");
    setStat(host, ".sim-removed", "9,000,000");
    setStat(host, ".sim-plan", "2.154 ms");
    setStat(host, ".sim-time", "5037.520 ms");
    setTxt(host, "Resultado: el plan <b>real</b> dice exactamente qué pasó y cuánto tardó cada pieza.");
    verdict(
      host,
      "good",
      "✅ EL PLAN ES LA BRÚJULA — 10M leídas · 9M descartadas · Execution Time <b>5037.520 ms</b><span class='sub'>La izquierda del nodo (cost=, rows=) estima; la derecha (actual time, rows=, loops=) es lo que realmente pasó. Planning 2.154 ms vs Execution 5037.520 ms: el tiempo se va en ejecutar el scan, no en planificarlo.</span>"
    );
    btn.disabled = false;
  },

  /* (c) 03b · B-tree antes/después — lección de selectividad */
  "sim-c": async function (host) {
    const article = scopeOf(host);
    buildBlocks(host, 10, "1M");
    const btn = $(".sim-run", host);
    btn.disabled = true;

    /* ANTES */
    setPhase(article, "antes", "run");
    setTxt(host, "▶ <b>ANTES</b> (sin índice): la misma consulta corre como Seq Scan…");
    await sleep(400);
    for (let i = 0; i < 10; i++) {
      setBlock(host, i, "read");
      await sleep(120);
      setBlock(host, i, "miss");
      await sleep(70);
    }
    setStat(host, ".sim-before", "5547.21 ms");
    setTxt(host, "ANTES: <b>Seq Scan</b> examina 10M filas → <b>5547.21 ms</b> (actual time=16.467..5563.674 · Rows Removed: 9000000).");
    await sleep(500);

    /* CREAR ÍNDICE */
    setPhase(article, "index", "run");
    setTxt(host, "▶ <code>CREATE INDEX idx_large_table_category ON large_table(category)</code> — índice creado en <b>44.45s</b>");
    await sleep(700);
    setTxt(host, "✅ <code>ANALYZE large_table;</code> — actualiza las estadísticas del planificador.");
    await sleep(500);

    /* DESPUÉS */
    setPhase(article, "despues", "run");
    setTxt(host, "▶ <b>DESPUÉS</b> (con B-tree): el plan cambia a Bitmap Heap Scan…");
    await sleep(400);
    for (let i = 0; i < 10; i++) {
      if (i === 4) {
        setBlock(host, i, "hit");
        setTxt(host, "Bitmap Heap Scan: leyendo la página que matchea (~1M filas)…");
        await sleep(380);
      } else {
        setBlock(host, i, "");
        setTxt(host, `Página ${i + 1}: no matchea → <b>no se lee</b>.`);
        await sleep(60);
      }
    }
    setStat(host, ".sim-after", "4399.28 ms");
    setStat(host, ".sim-speedup", "1.3x");
    setPhase(article, "compare", "win");
    setTxt(host, "Resultado: <b>5547.21 → 4399.28 ms</b> = <b>1.3x</b> más rápido (20.7% reducción).");
    verdict(
      host,
      "warn",
      "⚠️ 1.3X — BAJA SELECTIVIDAD: el filtro devuelve el 10% de la tabla (1M/10M)<span class='sub'>El plan cambió de Seq Scan a Bitmap Heap Scan (Rows Removed by Index Recheck: 3440885), pero como la consulta devuelve ~1M de filas (<code>SELECT *</code>), igual leyó muchísimo. 20.7% de reducción: 5547.21 → 4399.28 ms.</span>"
    );
    btn.disabled = false;
  },

  /* (d) 03c · índice compuesto — reporte GROUP BY */
  "sim-d": async function (host) {
    const article = scopeOf(host);
    buildBars(host, [
      { label: "A · sin índice",      val: "1917.99 ms", badge: "",   cls: "bad" },
      { label: "B · simple (c)",      val: "1856.86 ms", badge: "1.0x", cls: "warn" },
      { label: "C · compuesto (c,v)", val: "414.01 ms",  badge: "4.6x", cls: "good" },
    ]);
    const btn = $(".sim-run", host);
    btn.disabled = true;

    setPhase(article, "reporte", "run");
    setTxt(host, "▶ Reporte <b>GROUP BY</b>: SELECT category, AVG(value), COUNT(*) …");
    await sleep(500);

    setPhase(article, "casoA", "run");
    setTxt(host, "CASO A · sin índice → <b>Seq Scan</b> → 1917.99 ms");
    setBar(host, 0, 100);
    await sleep(700);

    setPhase(article, "casoB", "run");
    setTxt(host, "CASO B · índice simple (category) → <b>Bitmap Heap Scan</b> → 1856.86 ms (1.0x — casi nada)");
    setBar(host, 1, 97);
    await sleep(700);

    setPhase(article, "casoC", "win");
    setTxt(host, "CASO C · índice compuesto (category, value) → <b>Index Only Scan</b> → 414.01 ms (4.6x)");
    setBar(host, 2, 22);
    await sleep(800);

    setStat(host, ".sim-base", "1917.99 ms");
    setStat(host, ".sim-best", "414.01 ms");
    setStat(host, ".sim-speedup", "4.6x");
    setTxt(host, "Resultado: <b>4.6x</b> — el compuesto cubre WHERE + SELECT del reporte (<code>Heap Fetches: 71010</code>).");
    verdict(
      host,
      "good",
      "✅ 4.6X — INDEX ONLY SCAN (category, value)<span class='sub'>El índice compuesto contiene las columnas del WHERE y del SELECT: el reporte responde desde el índice. Heap Fetches: 71010 (visitas residuales por visibilidad). El índice simple fue un no-op (1.0x): no cubría <code>value</code>.</span>"
    );
    btn.disabled = false;
  },

  /* (e) 03d · índice cubriente — responde sin volver a la tabla (+ bonus 0.8x) */
  "sim-e": async function (host) {
    const article = scopeOf(host);
    buildBars(host, [
      { label: "A · sin índice",       val: "2531.10 ms", badge: "",    cls: "bad" },
      { label: "B · simple (c)",       val: "3236.70 ms", badge: "0.8x", cls: "bad" },
      { label: "C · compuesto (c,v)",  val: "866.52 ms",  badge: "2.9x", cls: "good" },
      { label: "D · cubriente (c,v,id)", val: "sin heap", badge: "100%", cls: "info" },
    ]);
    const btn = $(".sim-run", host);
    btn.disabled = true;

    setPhase(article, "setup", "run");
    setTxt(host, "▶ Reporte + <code>SELECT category, value</code> — 4 configuraciones…");
    await sleep(500);

    setPhase(article, "casoA", "run");
    setTxt(host, "CASO A · sin índice → <b>Seq Scan</b> → 2531.10 ms");
    setBar(host, 0, 78);
    await sleep(650);

    setPhase(article, "casoB", "run");
    setTxt(host, "CASO B · índice simple → <b>Bitmap Heap Scan</b> → 3236.70 ms (<b>0.8x ← ¡más lento que nada!</b>)");
    setBar(host, 1, 100);
    await sleep(700);

    setPhase(article, "casoC", "win");
    setTxt(host, "CASO C · índice compuesto → <b>Index Only Scan</b> → 866.52 ms (2.9x)");
    setBar(host, 2, 27);
    await sleep(700);

    setPhase(article, "cubriente", "win");
    setTxt(host, "CASO D · índice cubriente (category, value, id) → <b>Index Only Scan puro: sin heap</b>");
    setBar(host, 3, 6);
    await sleep(700);

    setStat(host, ".sim-base", "2531.10 ms");
    setStat(host, ".sim-best", "866.52 ms");
    setStat(host, ".sim-cover", "sin heap");
    setTxt(host, "Resultado: compuesto <b>2.9x</b> · simple <b>0.8x (peor)</b> · cubriente responde 100% desde el índice.");
    verdict(
      host,
      "good",
      "✅ 2.9X — EL COMPUESTO GANA · el simple salió <b>0.8x (más lento que nada)</b><span class='sub'>El índice simple pagó construir el bitmap + recheck (Bitmap Index Scan: 399 ms, recheck ~1.1M filas) y aun así volvió al heap por <code>value</code>. No es «más índices = más rápido»: es el índice correcto para la consulta.</span>"
    );
    btn.disabled = false;
  },

  /* (f) 04 · comparación de las 4 formas, lado a lado */
  "sim-f": async function (host) {
    const scope = scopeOf(host);
    resetForms(host);
    const btn = $(".sim-run", host);
    btn.disabled = true;

    setPhase(scope, "reporte", "run");
    const pl = $(".plan-lines .pline", host);
    if (pl) pl.classList.add("on");
    setTxt(host, "▶ El mismo reporte corre sobre las 4 configuraciones posibles…");
    await sleep(420);

    setPhase(scope, "casoA", "run");
    setForm(host, "A", "bad");
    setTxt(host, "CASO A · sin índice → <b>Parallel Seq Scan</b> → 2531.10 ms");
    await sleep(680);

    setPhase(scope, "casoB", "run");
    setForm(host, "B", "warn");
    setTxt(host, "CASO B · índice simple → <b>Bitmap Heap Scan</b> → 3236.70 ms (<b>0.8x ← ¡más lento!</b>)");
    await sleep(680);

    setPhase(scope, "casoC", "win");
    setForm(host, "C", "good");
    setTxt(host, "CASO C · índice compuesto → <b>Parallel Index Only Scan</b> → 866.52 ms (2.9x)");
    await sleep(680);

    setPhase(scope, "cubriente", "win");
    setForm(host, "D", "info");
    setTxt(host, "CASO D · índice cubriente → <b>Index Only Scan: sin heap</b>");
    await sleep(680);

    setTxt(host, "Resultado: compuesto <b>2.9x</b> · el simple fue <b>0.8x</b> · el cubriente responde sin heap.");
    verdict(
      host,
      "good",
      "✅ COMPARE LAS 4 FORMAS — A 2531.10 ms · B 3236.70 ms <b>(0.8x, más lento)</b> · C 866.52 ms <b>(2.9x)</b> · D sin heap<span class='sub'>El caso B construyó el bitmap (<code>Bitmap Index Scan</code>: 399 ms) y además volvió al heap con recheck de ~1.1M filas: pagó dos veces. La evidencia desmiente «más índices = más rápido».</span>"
    );
    btn.disabled = false;
  },
};

/* ================= tabs de código ================= */
$$(".tab-btn").forEach((b) =>
  b.addEventListener("click", () => {
    const code = b.closest(".sol-code");
    $$(".tab-btn", code).forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $$(".code-view", code).forEach((v) => (v.hidden = v.dataset.lang !== b.dataset.lang));
  })
);

/* ================= bind: cada sim-host → su runner ================= */
$$(".sim-host").forEach((host) => {
  const btn = $(".sim-run", host);
  if (!btn) return;
  const fn = simRunners[host.id];
  if (fn) btn.addEventListener("click", () => fn(host));
});
