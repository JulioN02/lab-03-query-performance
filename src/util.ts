// Utilidades de medición y reporter para LAB-03

export interface Measurement {
  label: string;
  duration: number;
  rowsExamined: number;
  scanType: string;
  estimatedCost: number;
  estimatedRows: number;
}

export interface ComparisonResult {
  before: Measurement;
  after: Measurement;
  speedup: number;
  reductionPercent: number;
}

// Extraer métricas del plan de EXPLAIN ANALYZE
export function extractMetrics(plan: string): Measurement | null {
  // Detectar tipo de scan
  let scanType = 'Unknown';
  if (plan.includes('Seq Scan')) scanType = 'Sequential Scan';
  else if (plan.includes('Index Only Scan')) scanType = 'Index Only Scan';
  else if (plan.includes('Index Scan using')) scanType = 'Index Scan';
  else if (plan.includes('Bitmap Heap Scan')) scanType = 'Bitmap Heap Scan';
  
  // Extraer costo estimado
  const costMatch = plan.match(/cost=\d+\.\d+\.\.(\d+\.\d+)/);
  const estimatedCost = costMatch ? parseFloat(costMatch[1]) : 0;
  
  // Extraer filas estimadas
  const estRowsMatch = plan.match(/rows=(\d+)/);
  const estimatedRows = estRowsMatch ? parseInt(estRowsMatch[1]) : 0;
  
  // Extraer tiempo actual
  const timeMatch = plan.match(/actual time=(\d+\.\d+)\.\.(\d+\.\d+)/);
  const duration = timeMatch ? parseFloat(timeMatch[2]) - parseFloat(timeMatch[1]) : 0;
  
  // Extraer filas reales
  const rowsMatch = plan.match(/rows=(\d+)\s+loops/);
  const rowsExamined = rowsMatch ? parseInt(rowsMatch[1]) : 0;
  
  return {
    label: '',
    duration,
    rowsExamined,
    scanType,
    estimatedCost,
    estimatedRows,
  };
}

// Comparar dos mediciones
export function compareMeasurements(before: Measurement, after: Measurement): ComparisonResult {
  const speedup = before.duration / after.duration;
  const reductionPercent = ((before.duration - after.duration) / before.duration) * 100;
  
  return {
    before,
    after,
    speedup,
    reductionPercent,
  };
}

// Imprimir métricas formateadas
export function printMetrics(metrics: Measurement, label: string): void {
  console.log(`\n📈 Métricas ${label}:`);
  console.log(`  Tipo de scan: ${metrics.scanType}`);
  console.log(`  Costo estimado: ${metrics.estimatedCost.toFixed(2)}`);
  console.log(`  Filas estimadas: ${metrics.estimatedRows.toLocaleString()}`);
  console.log(`  Tiempo real: ${metrics.duration.toFixed(2)}ms`);
  console.log(`  Filas reales: ${metrics.rowsExamined.toLocaleString()}`);
}

// Imprimir comparación formateada
export function printComparison(result: ComparisonResult, label: string): void {
  console.log(`\n📊 Comparación ${label}:`);
  console.log(`  ANTES:   ${result.before.duration.toFixed(2)}ms (${result.before.scanType})`);
  console.log(`  DESPUÉS: ${result.after.duration.toFixed(2)}ms (${result.after.scanType})`);
  console.log(`  Mejora:  ${result.speedup.toFixed(1)}x más rápido (${result.reductionPercent.toFixed(1)}% reducción)`);
}

// Generar tabla comparativa
export function generateComparisonTable(measurements: Measurement[]): string {
  const lines: string[] = [];
  
  lines.push('─'.repeat(90));
  lines.push('Caso          | Tipo de Scan      | Tiempo (ms) | Filas Exam. | Costo Est.');
  lines.push('─'.repeat(90));
  
  measurements.forEach((m) => {
    lines.push(
      `${m.label.padEnd(14)}| ${m.scanType.padEnd(18)}| ${m.duration.toFixed(2).padStart(10)} | ${m.rowsExamined.toLocaleString().padStart(10)} | ${m.estimatedCost.toFixed(2).padStart(10)}`
    );
  });
  
  lines.push('─'.repeat(90));
  
  return lines.join('\n');
}

// Formatear duración en formato legible
export function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}μs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

// Formatear número con separadores de miles
export function formatNumber(n: number): string {
  return n.toLocaleString();
}
