import { pool, closePool, explainAnalyze } from './db.ts';

async function runCoveringExperiment() {
  const client = await pool.connect();
  
  try {
    console.log('🔬 Experimento 4: Índice compuesto/cubriente');
    console.log('─'.repeat(70));
    console.log('Objetivo: observar la diferencia entre índice simple, compuesto y cubriente');
    console.log('─'.repeat(70));
    
    // Verificar que hay datos
    const countResult = await client.query('SELECT COUNT(*) as count FROM large_table');
    const totalRows = parseInt(countResult.rows[0].count);
    
    if (totalRows === 0) {
      console.log('❌ No hay datos en la tabla. Ejecuta primero: npm run db:load');
      return;
    }
    
    console.log(`\n📊 Tabla actual: ${totalRows.toLocaleString()} filas`);
    
    // Limpiar índices para el experimento (ambos esquemas de nombres:
    // idx_large_table_* de exp-03 y idx_* propios de exp-04)
    console.log('\n🔄 Limpiando índices...');
    await client.query('DROP INDEX IF EXISTS idx_large_table_category');
    await client.query('DROP INDEX IF EXISTS idx_large_table_category_value');
    await client.query('DROP INDEX IF EXISTS idx_large_table_category_covering');
    await client.query('DROP INDEX IF EXISTS idx_category');
    await client.query('DROP INDEX IF EXISTS idx_category_value');
    await client.query('DROP INDEX IF EXISTS idx_category_covering');
    console.log('✅ Índices eliminados');
    
    // Seleccionar categoría para la prueba
    const testCategory = 'Electronics';
    
    // ═══════════════════════════════════════════════════════════════════
    // CONSULTA 1: Reporte con JOIN implícito (category + value)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📊 CONSULTA 1: Reporte de categorías');
    console.log('═'.repeat(70));
    
    const queryReport = `
      SELECT category, AVG(value) as avg_value, COUNT(*) as count
      FROM large_table
      WHERE category = '${testCategory}'
      GROUP BY category
    `;
    
    // CASO A: Sin índice
    console.log('\n📉 CASO A: Sin índice');
    console.log('─'.repeat(70));
    
    const planA = await explainAnalyze(queryReport);
    console.log(planA);
    
    const metricsA = extractMetrics(planA);
    printMetrics(metricsA, 'CASO A');
    
    // CASO B: Índice simple en category
    console.log('\n🔧 CASO B: Creando índice simple en category...');
    await client.query('CREATE INDEX idx_category ON large_table(category)');
    await client.query('ANALYZE large_table');
    console.log('✅ Índice simple creado');
    
    const planB = await explainAnalyze(queryReport);
    console.log('\n📋 Plan de ejecución:');
    console.log('─'.repeat(70));
    console.log(planB);
    console.log('─'.repeat(70));
    
    const metricsB = extractMetrics(planB);
    printMetrics(metricsB, 'CASO B');
    
    // CASO C: Índice compuesto (category, value)
    console.log('\n🔧 CASO C: Creando índice compuesto (category, value)...');
    await client.query('DROP INDEX IF EXISTS idx_category');
    await client.query('CREATE INDEX idx_category_value ON large_table(category, value)');
    await client.query('ANALYZE large_table');
    console.log('✅ Índice compuesto creado');
    
    const planC = await explainAnalyze(queryReport);
    console.log('\n📋 Plan de ejecución:');
    console.log('─'.repeat(70));
    console.log(planC);
    console.log('─'.repeat(70));
    
    const metricsC = extractMetrics(planC);
    printMetrics(metricsC, 'CASO C');
    
    // CASO D: Índice cubriente (category, value, id)
    console.log('\n🔧 CASO D: Creando índice cubriente (category, value, id)...');
    await client.query('DROP INDEX IF EXISTS idx_category_value');
    await client.query('CREATE INDEX idx_category_covering ON large_table(category, value, id)');
    await client.query('ANALYZE large_table');
    console.log('✅ Índice cubriente creado');
    
    // Consulta que puede responder completamente desde el índice
    const queryCovering = `
      SELECT category, value
      FROM large_table
      WHERE category = '${testCategory}'
    `;
    
    const planD = await explainAnalyze(queryCovering);
    console.log('\n📋 Plan de ejecución (consulta de solo lectura):');
    console.log('─'.repeat(70));
    console.log(planD);
    console.log('─'.repeat(70));
    
    const metricsD = extractMetrics(planD);
    printMetrics(metricsD, 'CASO D');
    
    // ═══════════════════════════════════════════════════════════════════
    // CONSULTA 2: Rango de valores
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📊 CONSULTA 2: Rango de valores');
    console.log('═'.repeat(70));
    
    const queryRange = `
      SELECT id, name, value
      FROM large_table
      WHERE category = '${testCategory}' AND value BETWEEN 100 AND 500
      ORDER BY value DESC
      LIMIT 10
    `;
    
    // Con índice compuesto (category, value)
    console.log('\n📋 Con índice compuesto (category, value):');
    console.log('─'.repeat(70));
    
    const planRange = await explainAnalyze(queryRange);
    console.log(planRange);
    console.log('─'.repeat(70));
    
    const metricsRange = extractMetrics(planRange);
    printMetrics(metricsRange, 'RANGO');
    
    // ═══════════════════════════════════════════════════════════════════
    // RESUMEN COMPARATIVO
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📊 RESUMEN COMPARATIVO');
    console.log('═'.repeat(70));
    
    console.log('\n📋 Tabla comparativa (Reporte de categorías):');
    console.log('─'.repeat(95));
    console.log('Caso          | Tipo de Scan      | Tiempo (ms) | Filas Exam. | Mejora vs Sin Índice');
    console.log('─'.repeat(95));
    
    const cases = [
      { name: 'Sin índice', metrics: metricsA },
      { name: 'Índice simple', metrics: metricsB },
      { name: 'Índice compuesto', metrics: metricsC },
      { name: 'Índice cubriente', metrics: metricsD },
    ];
    
    const baselineTime = metricsA?.actualTime || 1;
    
    cases.forEach(({ name, metrics }) => {
      if (metrics) {
        const speedup = (baselineTime / metrics.actualTime).toFixed(1);
        console.log(
          `${name.padEnd(14)}| ${metrics.scanType.padEnd(18)}| ${metrics.actualTime.toFixed(2).padStart(10)} | ${metrics.rowsExamined.toLocaleString().padStart(10)} | ${speedup}x`
        );
      } else {
        console.log(`${name.padEnd(14)}| ${'N/A'.padEnd(18)}| ${'N/A'.padStart(10)} | ${'N/A'.padStart(10)} | N/A`);
      }
    });
    
    console.log('─'.repeat(95));
    
    console.log('\n📌 CONCLUSIONES:');
    console.log('─'.repeat(70));
    console.log('1. Índice simple: bueno para filtros por equality');
    console.log('2. Índice compuesto: mejor para filtros + ordenamiento/agregación');
    console.log('3. Índice cubriente: mejor para consultas de solo lectura (Index Only Scan)');
    console.log('4. El beneficio depende del patrón de consulta específico');
    console.log('5. Más columnas en el índice = más espacio en disco, pero menos I/O en queries');
    console.log('─'.repeat(70));
    
    console.log('\n🎯 CUÁNDO USAR CADA UNO:');
    console.log('─'.repeat(70));
    console.log('• Índice simple: consultas WHERE category = ? (equality)');
    console.log('• Índice compuesto: consultas WHERE category = ? AND value BETWEEN ? AND ?');
    console.log('• Índice cubriente: consultas SELECT category, value WHERE category = ?');
    console.log('  (sin volver a la tabla principal)');
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
  else if (plan.includes('Index Only Scan')) scanType = 'Index Only Scan';
  else if (plan.includes('Index Scan using') || plan.includes('Index Scan Backward')) scanType = 'Index Scan';
  else if (plan.includes('Bitmap Heap Scan')) scanType = 'Bitmap Heap Scan';

  // Tomar las métricas del nodo de scan que lee la tabla (el primero que
  // aparece en el plan), no del nodo raíz (ej. GroupAggregate).
  const scanLines = plan.split('\n').filter((line) =>
    /Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan/.test(line)
  );
  const scanLine = scanLines[0] ?? plan;

  // Extraer costo estimado
  const costMatch = scanLine.match(/cost=\d+\.\d+\.\.(\d+\.\d+)/);
  const estimatedCost = costMatch ? parseFloat(costMatch[1]) : 0;

  // Extraer filas estimadas
  const estRowsMatch = scanLine.match(/rows=(\d+)/);
  const estimatedRows = estRowsMatch ? parseInt(estRowsMatch[1]) : 0;

  // Extraer tiempo actual
  const timeMatch = scanLine.match(/actual time=(\d+\.\d+)\.\.(\d+\.\d+)/);
  const actualTime = timeMatch ? parseFloat(timeMatch[2]) - parseFloat(timeMatch[1]) : 0;

  // Extraer filas reales
  const rowsMatch = scanLine.match(/rows=(\d+)\s+loops/);
  const rowsExamined = rowsMatch ? parseInt(rowsMatch[1]) : 0;

  // Extraer loops
  const loopsMatch = scanLine.match(/loops=(\d+)/);
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
runCoveringExperiment()
  .then(() => {
    console.log('\n✅ Experimento 4 completado');
    closePool();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Experimento falló:', error);
    closePool();
    process.exit(1);
  });
