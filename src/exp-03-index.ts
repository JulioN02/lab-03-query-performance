import { pool, closePool, explainAnalyze } from './db.ts';

async function runIndexExperiment() {
  const client = await pool.connect();
  
  try {
    console.log('🔬 Experimento 3: Índice compuesto y re-medición');
    console.log('─'.repeat(70));
    console.log('Objetivo: crear índices multi-columna y observar Index Only Scan');
    console.log('─'.repeat(70));
    
    // Verificar que hay datos
    const countResult = await client.query('SELECT COUNT(*) as count FROM large_table');
    const totalRows = parseInt(countResult.rows[0].count);
    
    if (totalRows === 0) {
      console.log('❌ No hay datos en la tabla. Ejecuta primero: npm run db:load');
      return;
    }
    
    console.log(`\n📊 Tabla actual: ${totalRows.toLocaleString()} filas`);
    
    // Verificar índices existentes
    const indexCheck = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'large_table'
      ORDER BY indexname
    `);
    
    console.log('\n📋 Índices existentes:');
    console.log('─'.repeat(70));
    if (indexCheck.rows.length === 0) {
      console.log('  (ninguno)');
    } else {
      indexCheck.rows.forEach((row: any) => {
        console.log(`  - ${row.indexname}`);
        console.log(`    ${row.indexdef}`);
      });
    }
    console.log('─'.repeat(70));
    
    // Eliminar índices existentes para el experimento (ambos esquemas de
    // nombres: idx_large_table_* propios y idx_* de exp-04)
    console.log('\n🔄 Limpiando índices para el experimento...');
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
    // CASO 1: Sin índice
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📉 CASO 1: Sin índice');
    console.log('═'.repeat(70));
    
    const query1 = `SELECT category, AVG(value), COUNT(*) FROM large_table WHERE category = '${testCategory}' GROUP BY category`;
    const plan1 = await explainAnalyze(query1);
    
    console.log('\n📋 Plan de ejecución:');
    console.log('─'.repeat(70));
    console.log(plan1);
    console.log('─'.repeat(70));
    
    const metrics1 = extractMetrics(plan1);
    printMetrics(metrics1, 'CASO 1');
    
    // ═══════════════════════════════════════════════════════════════════
    // CASO 2: Índice simple en category
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('🔧 CASO 2: Creando índice simple en category...');
    console.log('═'.repeat(70));
    
    await client.query('CREATE INDEX idx_large_table_category ON large_table(category)');
    await client.query('ANALYZE large_table');
    console.log('✅ Índice simple creado y estadísticas actualizadas');
    
    const plan2 = await explainAnalyze(query1);
    
    console.log('\n📋 Plan de ejecución:');
    console.log('─'.repeat(70));
    console.log(plan2);
    console.log('─'.repeat(70));
    
    const metrics2 = extractMetrics(plan2);
    printMetrics(metrics2, 'CASO 2');
    
    // ═══════════════════════════════════════════════════════════════════
    // CASO 3: Índice compuesto (category, value)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('🔧 CASO 3: Creando índice compuesto (category, value)...');
    console.log('═'.repeat(70));
    
    await client.query('DROP INDEX IF EXISTS idx_large_table_category');
    await client.query('CREATE INDEX idx_large_table_category_value ON large_table(category, value)');
    await client.query('ANALYZE large_table');
    console.log('✅ Índice compuesto creado y estadísticas actualizadas');
    
    const plan3 = await explainAnalyze(query1);
    
    console.log('\n📋 Plan de ejecución:');
    console.log('─'.repeat(70));
    console.log(plan3);
    console.log('─'.repeat(70));
    
    const metrics3 = extractMetrics(plan3);
    printMetrics(metrics3, 'CASO 3');
    
    // ═══════════════════════════════════════════════════════════════════
    // CASO 4: Índice cubriente (covering index)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('🔧 CASO 4: Creando índice cubriente (category, value, id)...');
    console.log('═'.repeat(70));
    
    await client.query('DROP INDEX IF EXISTS idx_large_table_category_value');
    await client.query('CREATE INDEX idx_large_table_category_covering ON large_table(category, value, id)');
    await client.query('ANALYZE large_table');
    console.log('✅ Índice cubriente creado y estadísticas actualizadas');
    
    // Consulta que puede responder completamente desde el índice
    const queryCovering = `SELECT category, value FROM large_table WHERE category = '${testCategory}'`;
    
    const plan4 = await explainAnalyze(queryCovering);
    
    console.log('\n📋 Plan de ejecución (consulta de solo lectura):');
    console.log('─'.repeat(70));
    console.log(plan4);
    console.log('─'.repeat(70));
    
    const metrics4 = extractMetrics(plan4);
    printMetrics(metrics4, 'CASO 4');
    
    // ═══════════════════════════════════════════════════════════════════
    // RESUMEN COMPARATIVO
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('📊 RESUMEN COMPARATIVO');
    console.log('═'.repeat(70));
    
    console.log('\n📋 Tabla comparativa:');
    console.log('─'.repeat(90));
    console.log('Caso          | Tipo de Scan      | Tiempo (ms) | Filas Exam. | Mejora vs Sin Índice');
    console.log('─'.repeat(90));
    
    const cases = [
      { name: 'Sin índice', metrics: metrics1 },
      { name: 'Índice simple', metrics: metrics2 },
      { name: 'Índice compuesto', metrics: metrics3 },
      { name: 'Índice cubriente', metrics: metrics4 },
    ];
    
    const baselineTime = metrics1?.actualTime || 1;
    
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
    
    console.log('─'.repeat(90));
    
    console.log('\n📌 CONCLUSIONES:');
    console.log('─'.repeat(70));
    console.log('1. Índice simple: convierte Seq Scan en Index Scan');
    console.log('2. Índice compuesto: puede mejorar la selección de filas');
    console.log('3. Índice cubriente: permite Index Only Scan (sin volver a la tabla)');
    console.log('4. La mejora depende del patrón de consulta y las columnas involucradas');
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
runIndexExperiment()
  .then(() => {
    console.log('\n✅ Experimento 3 completado');
    closePool();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Experimento falló:', error);
    closePool();
    process.exit(1);
  });
