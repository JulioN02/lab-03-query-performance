import { pool, closePool } from './db.ts';

// Categorías para datos realistas (patrón determinista: id % 10 → categoría)
const CATEGORIES = [
  'Electronics', 'Clothing', 'Books', 'Home', 'Sports',
  'Toys', 'Food', 'Health', 'Automotive', 'Garden',
];

/**
 * Carga N filas con INSERT ... SELECT generate_series (SQL puro).
 * Es 10-50x más rápido que insertar por lotes desde JS: PostgreSQL genera
 * los datos internamente sin round-trips al cliente.
 *
 * Patrón determinista (idéntico al que produjo la evidencia del lab):
 *   name     = 'Item_' + id con pad a 7 dígitos
 *   category = CATEGORIES[id % 10]  → ~1M por categoría en 10M filas
 *   value    = ((id*7 + 13) % 1000) + 0.99
 */
async function loadSize(rows: number): Promise<void> {
  const client = await pool.connect();
  try {
    console.log(`📦 Cargando ${rows.toLocaleString()} filas (generate_series)...`);

    // Lote en SQL puro — una sola sentencia, sin round-trips
    const categoriesArray = `ARRAY[${CATEGORIES.map((c) => `'${c}'`).join(', ')}]`;
    const sql = `
      INSERT INTO large_table (name, category, value)
      SELECT
        'Item_' || lpad(g::text, 7, '0'),
        (${categoriesArray})[1 + (g % ${CATEGORIES.length})],
        ((g * 7 + 13) % 1000) + 0.99
      FROM generate_series(1, ${rows}) AS g
    `;

    const start = performance.now();
    await client.query(sql);
    const duration = (performance.now() - start) / 1000;
    console.log(`  ✅ ${rows.toLocaleString()} filas cargadas en ${duration.toFixed(2)}s`);

    // Actualizar estadísticas del planificador (imprescindible para EXPLAIN)
    console.log('  📊 Ejecutando ANALYZE...');
    await client.query('ANALYZE large_table');

    // Verificación
    const countResult = await client.query('SELECT COUNT(*) as count FROM large_table');
    const count = parseInt(countResult.rows[0].count);
    console.log(`  ✅ Verificación: ${count.toLocaleString()} filas en la tabla`);
  } finally {
    client.release();
  }
}

async function loadData() {
  const client = await pool.connect();
  try {
    // Tamaño configurable: LAB_ROWS (default 10M, el que produce la evidencia)
    const rows = parseInt(process.env.LAB_ROWS || '10000000');

    console.log('🚀 Iniciando carga de datos...');
    console.log('─'.repeat(60));

    const countResult = await client.query('SELECT COUNT(*) as count FROM large_table');
    const currentCount = parseInt(countResult.rows[0].count);
    if (currentCount > 0) {
      console.log(`  ⚠️  Hay ${currentCount.toLocaleString()} filas. Truncando tabla...`);
      await client.query('TRUNCATE TABLE large_table RESTART IDENTITY');
    }

    await loadSize(rows);

    console.log('─'.repeat(60));
    console.log('✅ Carga de datos completada');
  } catch (error) {
    console.error('\n❌ Error durante la carga:', error);
    throw error;
  } finally {
    client.release();
  }
}

loadData()
  .then(() => {
    console.log('\n🎉 ¡Listo para experimentar!');
    closePool();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Carga falló:', error);
    closePool();
    process.exit(1);
  });