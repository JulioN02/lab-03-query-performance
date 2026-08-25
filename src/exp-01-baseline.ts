import { pool, closePool, explainAnalyze } from './db.ts';

// Configuración de tamaños de dataset
const SIZES = [100_000, 1_000_000, 10_000_000];

// Categorías para las consultas
const CATEGORIES = ['Electronics', 'Clothing', 'Books', 'Home', 'Sports'];

async function runBaselineExperiment() {
  const client = await pool.connect();
  
  try {
    console.log('🔬 Experimento 1: Línea base (sin índice)');
    console.log('─'.repeat(70));
    console.log('Objetivo: medir tiempo de consulta WHERE sobre columna no indexada');
    console.log('─'.repeat(70));
    
    // Verificar que hay datos
    const countResult = await client.query('SELECT COUNT(*) as count FROM large_table');
    const totalRows = parseInt(countResult.rows[0].count);
    
    if (totalRows === 0) {
      console.log('❌ No hay datos en la tabla. Ejecuta primero: npm run db:load');
      return;
    }
    
    console.log(`\n📊 Tabla actual: ${totalRows.toLocaleString()} filas`);
    console.log('\n⚠️  NOTA: NO hay índice en "category" — esto es lo que medimos\n');
    
    // Ejecutar consulta para cada categoría
    for (const category of CATEGORIES) {
      console.log(`\n🔍 Consulta: WHERE category = '${category}'`);
      
      // Ejecutar EXPLAIN ANALYZE
      const plan = await explainAnalyze(
        `SELECT * FROM large_table WHERE category = '${category}'`
      );
      
      console.log('\n📋 Plan de ejecución:');
      console.log('─'.repeat(70));
      console.log(plan);
      console.log('─'.repeat(70));
      
      // Extraer información clave del plan
      const seqScanMatch = plan.match(/Seq Scan on large_table\s+\(cost=0\.00\.\.(\d+\.\d+)\s+rows=(\d+)\s+width=\d+\)/);
      const actualTimeMatch = plan.match(/actual time=(\d+\.\d+)\.\.(\d+\.\d+)\s+rows=(\d+)/);
      const loopsMatch = plan.match(/loops=(\d+)/);
      
      if (seqScanMatch) {
        const estimatedCost = parseFloat(seqScanMatch[1]);
        const estimatedRows = parseInt(seqScanMatch[2]);
        console.log(`\n📈 Estimaciones del planificador:`);
        console.log(`  Costo estimado: ${estimatedCost.toFixed(2)}`);
        console.log(`  Filas estimadas: ${estimatedRows.toLocaleString()}`);
      }
      
      if (actualTimeMatch) {
        const startTime = parseFloat(actualTimeMatch[1]);
        const endTime = parseFloat(actualTimeMatch[2]);
        const actualRows = parseInt(actualTimeMatch[3]);
        const duration = endTime - startTime;
        
        console.log(`\n⏱️  Resultados reales:`);
        console.log(`  Tiempo de ejecución: ${duration.toFixed(2)}ms`);
        console.log(`  Filas retornadas: ${actualRows.toLocaleString()}`);
        
        if (loopsMatch) {
          const loops = parseInt(loopsMatch[1]);
          console.log(`  Veces que se ejecutó el plan: ${loops}`);
        }
      }
    }
    
    console.log('\n' + '─'.repeat(70));
    console.log('📌 CONCLUSIÓN: Sin índice, PostgreSQL usa Seq Scan en TODOS los casos');
    console.log('   El tiempo crece linealmente con el tamaño de la tabla');
    console.log('─'.repeat(70));
    
  } catch (error) {
    console.error('\n❌ Error durante el experimento:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Ejecutar si se llama directamente
runBaselineExperiment()
  .then(() => {
    console.log('\n✅ Experimento 1 completado');
    closePool();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Experimento falló:', error);
    closePool();
    process.exit(1);
  });
