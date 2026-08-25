import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool, explainAnalyze } from '../src/db.ts';

// Índices creados por los experimentos (exp-02/03/04) y por tests anteriores.
// Se eliminan al inicio para que cada invariante parta del estado base:
// tabla sin índice sobre "category" (solo pk + idx_large_table_created_at).
const EXPERIMENT_INDEXES = [
  'idx_large_table_category',
  'idx_large_table_category_value',
  'idx_large_table_category_covering',
  'idx_category',
  'idx_category_value',
  'idx_category_covering',
  'idx_test_category',
  'idx_test_category_time',
  'idx_test_category_covering',
];

async function resetIndexState(client: any): Promise<void> {
  for (const indexName of EXPERIMENT_INDEXES) {
    await client.query(`DROP INDEX IF EXISTS ${indexName}`);
  }
}

describe('LAB-03 Query Performance - Invariantes', () => {
  before(async () => {
    // Verificar conexión y partir de un estado de índices limpio
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      await resetIndexState(client);
      await client.query('ANALYZE large_table');
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  it('debería tener datos en la tabla', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT COUNT(*) as count FROM large_table');
      const count = parseInt(result.rows[0].count);

      assert.ok(count > 0, `La tabla debería tener datos, pero tiene ${count} filas`);
      console.log(`  ✅ Tabla tiene ${count.toLocaleString()} filas`);
    } finally {
      client.release();
    }
  });

  it('la consulta sin índice debería usar Seq Scan', async () => {
    const client = await pool.connect();
    try {
      await resetIndexState(client);

      const plan = await explainAnalyze(
        `SELECT * FROM large_table WHERE category = 'Electronics'`
      );

      assert.ok(
        plan.includes('Seq Scan'),
        `La consulta sin índice debería usar Seq Scan, pero usó:\n${plan}`
      );
      console.log('  ✅ Consulta sin índice usa Seq Scan');
    } finally {
      client.release();
    }
  });

  it('la consulta con índice debería usar Index Scan', async () => {
    const client = await pool.connect();
    try {
      await resetIndexState(client);

      // Crear índice temporal para la prueba
      await client.query('CREATE INDEX IF NOT EXISTS idx_test_category ON large_table(category)');
      await client.query('ANALYZE large_table');

      const plan = await explainAnalyze(
        `SELECT * FROM large_table WHERE category = 'Electronics'`
      );

      assert.ok(
        plan.includes('Index Scan') || plan.includes('Bitmap'),
        `La consulta con índice debería usar Index Scan o Bitmap, pero usó:\n${plan}`
      );
      console.log('  ✅ Consulta con índice usa Index Scan/Bitmap');

      // Limpiar
      await client.query('DROP INDEX IF EXISTS idx_test_category');
      await client.query('ANALYZE large_table');
    } finally {
      client.release();
    }
  });

  it('el tiempo con índice debería ser menor que sin índice', async () => {
    const client = await pool.connect();
    try {
      await resetIndexState(client);

      // Consulta que un índice cubriente puede responder sin volver a la tabla.
      // Sin índice: Seq Scan sobre toda la tabla (10M filas).
      const query = `SELECT category, value FROM large_table WHERE category = 'Clothing'`;

      // Medir sin índice
      const planBefore = await explainAnalyze(query);
      const timeBefore = extractTime(planBefore);

      // Crear índice cubriente (category, value) → Index Only Scan
      await client.query('CREATE INDEX IF NOT EXISTS idx_test_category_covering ON large_table(category, value)');
      await client.query('ANALYZE large_table');

      // Medir con índice
      const planAfter = await explainAnalyze(query);
      const timeAfter = extractTime(planAfter);

      // Verificar mejora (al menos 2x más rápido)
      const speedup = timeBefore / timeAfter;
      assert.ok(
        speedup >= 2,
        `El tiempo con índice debería ser al menos 2x menor. Antes: ${timeBefore.toFixed(2)}ms, Después: ${timeAfter.toFixed(2)}ms, Mejora: ${speedup.toFixed(1)}x`
      );

      console.log(`  ✅ Mejora de rendimiento: ${speedup.toFixed(1)}x más rápido`);
      console.log(`     Sin índice: ${timeBefore.toFixed(2)}ms`);
      console.log(`     Con índice: ${timeAfter.toFixed(2)}ms`);

      // Limpiar
      await client.query('DROP INDEX IF EXISTS idx_test_category_covering');
      await client.query('ANALYZE large_table');
    } finally {
      client.release();
    }
  });
});

function extractTime(plan: string): number {
  const timeMatch = plan.match(/actual time=(\d+\.\d+)\.\.(\d+\.\d+)/);
  if (timeMatch) {
    return parseFloat(timeMatch[2]) - parseFloat(timeMatch[1]);
  }
  return 0;
}