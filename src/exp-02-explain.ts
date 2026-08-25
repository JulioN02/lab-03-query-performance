import { pool, closePool, explainAnalyze } from './db.ts';

async function runExplainExperiment() {
  const client = await pool.connect();
  
  try {
    console.log('🔬 Experimento 2: EXPLAIN ANALYZE antes/después del índice');
    console.log('─'.repeat(70));
    console.log('Objetivo: mostrar cómo cambia el plan al agregar un índice B-tree');
    console.log('─'.repeat(70));
    
    // Verificar que hay datos
    const countResult = await client.query('SELECT COUNT(*) as count FROM large_table');
    const totalRows = parseInt(countResult.rows[0].count);
    
    if (totalRows === 0) {
      console.log('❌ No hay datos en la tabla. Ejecuta primero: npm run db:load');
      return;
    }
    
    console.log(`\n📊 Tabla actual: ${totalRows.toLocaleString()} filas`);
    
    // Verificar si ya existe un índice en category
    const indexCheck = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'large_table' AND indexname LIKE '%category%'
    `);
    
    if (indexCheck.rows.length > 0) {
      console.log('\n⚠️  Ya existe un índice en category:');
      indexCheck.rows.forEach((row: any) => {
        console.log(`  - ${row.indexname}: ${row.indexdef}`);
      });
      console.log('\n🔄 Eliminando índice para el experimento...');
      await client.query('DROP INDEX IF EXISTS idx_large_table_category');
    }
    
    // Seleccionar categoría para la prueba
    const testCategory = 'Electronics';
    
    // ═══════════════════════════════════════════════════════════════════
    // ANTES del índice
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📉 ANTES del índice (sin índice en category)');
    console.log('═'.repeat(70));
    
    const planBefore = await explainAnalyze(
      `SELECT * FROM large_table WHERE category = '${testCategory}'`
    );
    
    console.log('\n📋 Plan de ejecución:');
    console.log('─'.repeat(70));
    console.log(planBefore);
    console.log('─'.repeat(70));
    
    // Extraer métricas
    const metricsBefore = extractMetrics(planBefore);
    printMetrics(metricsBefore, 'ANTES');
    
    // ═══════════════════════════════════════════════════════════════════
    // CREAR ÍNDICE
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('🔧 CREANDO ÍNDICE B-tree en category...');
    console.log('═'.repeat(70));
    
    const indexStartTime = performance.now();
    await client.query('CREATE INDEX idx_large_table_category ON large_table(category)');
    const indexDuration = performance.now() - indexStartTime;
    
    console.log(`✅ Índice creado en ${(indexDuration / 1000).toFixed(2)}s`);
    
    // Ejecutar ANALYZE para actualizar estadísticas
    console.log('📊 Ejecutando ANALYZE...');
    await client.query('ANALYZE large_table');
    console.log('✅ Estadísticas actualizadas');
    
    // ═══════════════════════════════════════════════════════════════════
    // DESPUÉS del índice
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📈 DESPUÉS del índice (con B-tree en category)');
    console.log('═'.repeat(70));
    
    const planAfter = await explainAnalyze(
      `SELECT * FROM large_table WHERE category = '${testCategory}'`
    );
    
    console.log('\n📋 Plan de ejecución:');
    console.log('─'.repeat(70));
    console.log(planAfter);
    console.log('─'.repeat(70));
    
    // Extraer métricas
    const metricsAfter = extractMetrics(planAfter);
    printMetrics(metricsAfter, 'DESPUÉS');
    
    // ═══════════════════════════════════════════════════════════════════
    // COMPARACIÓN
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📊 COMPARACIÓN');
    console.log('═'.repeat(70));
    
    if (metricsBefore && metricsAfter) {
      const speedup = metricsBefore.actualTime / metricsAfter.actualTime;
      const reduction = ((metricsBefore.actualTime - metricsAfter.actualTime) / metricsBefore.actualTime) * 100;
      
      console.log(`\n⏱️  Tiempo de ejecución:`);
      console.log(`  ANTES:   ${metricsBefore.actualTime.toFixed(2)}ms`);
      console.log(`  DESPUÉS: ${metricsAfter.actualTime.toFixed(2)}ms`);
      console.log(`  Mejora:  ${speedup.toFixed(1)}x más rápido (${reduction.toFixed(1)}% reducción)`);
      
      console.log(`\n📊 Filas examinadas:`);
      console.log(`  ANTES:   ${metricsBefore.rowsExamined.toLocaleString()} (Seq Scan - TODA la tabla)`);
      console.log(`  DESPUÉS: ${metricsAfter.rowsExamined.toLocaleString()} (Index Scan - solo filas coincidentes)`);
      
      console.log(`\n🎯 Tipo de scan:`);
      console.log(`  ANTES:   ${metricsBefore.scanType}`);
      console.log(`  DESPUÉS: ${metricsAfter.scanType}`);
    }
    
    console.log('\n' + '─'.repeat(70));
    console.log('📌 CONCLUSIÓN: El índice B-tree transforma Seq Scan en Index Scan');
    console.log('   La mejora es de órdenes de magnitud, no incremental');
    console.log('─'.repeat(70));
    
  } catch (error) {
    console.error('\n❌ Error durante el experimento:', error);
    throw error;
  } finally {
    client.release();
  }
}

interface PlanMetrics {
  scanType: string;
  estimatedCost: number;
  estimatedRows: number;
  actualTime: number;
  rowsExamined: number;
  loops: number;
}

function extractMetrics(plan: string): PlanMetrics | null {
  // Detectar tipo de scan
  let scanType = 'Unknown';
  if (plan.includes('Seq Scan')) scanType = 'Sequential Scan';
  else if (plan.includes('Index Scan using')) scanType = 'Index Scan';
  else if (plan.includes('Index Only Scan')) scanType = 'Index Only Scan';
  else if (plan.includes('Bitmap Heap Scan')) scanType = 'Bitmap Heap Scan';
  
  // Extraer costo estimado
  const costMatch = plan.match(/cost=\d+\.\d+\.\.(\d+\.\d+)/);
  const estimatedCost = costMatch ? parseFloat(costMatch[1]) : 0;
  
  // Extraer filas estimadas
  const estRowsMatch = plan.match(/rows=(\d+)/);
  const estimatedRows = estRowsMatch ? parseInt(estRowsMatch[1]) : 0;
  
  // Extraer tiempo actual
  const timeMatch = plan.match(/actual time=(\d+\.\d+)\.\.(\d+\.\d+)/);
  const actualTime = timeMatch ? parseFloat(timeMatch[2]) - parseFloat(timeMatch[1]) : 0;
  
  // Extraer filas reales
  const rowsMatch = plan.match(/rows=(\d+)\s+loops/);
  const rowsExamined = rowsMatch ? parseInt(rowsMatch[1]) : 0;
  
  // Extraer loops
  const loopsMatch = plan.match(/loops=(\d+)/);
  const loops = loopsMatch ? parseInt(loopsMatch[1]) : 1;
  
  return {
    scanType,
    estimatedCost,
    estimatedRows,
    actualTime,
    rowsExamined,
    loops,
  };
}

function printMetrics(metrics: PlanMetrics | null, label: string) {
  if (!metrics) {
    console.log(`\n⚠️  No se pudieron extraer métricas para ${label}`);
    return;
  }
  
  console.log(`\n📈 Métricas ${label}:`);
  console.log(`  Tipo de scan: ${metrics.scanType}`);
  console.log(`  Costo estimado: ${metrics.estimatedCost.toFixed(2)}`);
  console.log(`  Filas estimadas: ${metrics.estimatedRows.toLocaleString()}`);
  console.log(`  Tiempo real: ${metrics.actualTime.toFixed(2)}ms`);
  console.log(`  Filas reales: ${metrics.rowsExamined.toLocaleString()}`);
  console.log(`  Loops: ${metrics.loops}`);
}

// Ejecutar si se llama directamente
runExplainExperiment()
  .then(() => {
    console.log('\n✅ Experimento 2 completado');
    closePool();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Experimento falló:', error);
    closePool();
    process.exit(1);
  });
