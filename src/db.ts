import pg from 'pg';

const { Pool } = pg;

// Configuración de conexión (sobreescribible por variables de entorno)
// Default: Docker compose del lab (postgres:16 en localhost:55434, user postgres, pass lab)
const config = {
  host: process.env.LAB_PGHOST || 'localhost',
  port: parseInt(process.env.LAB_PGPORT || '55434'),
  user: process.env.LAB_PGUSER || 'postgres',
  password: process.env.LAB_PGPASSWORD || 'lab',
  database: process.env.LAB_PGDATABASE || 'lab_query_performance',
};

// Pool de conexiones reutilizable
export const pool = new Pool(config);

// Función para obtener una conexión del pool
export async function getClient() {
  return await pool.connect();
}

// Función para ejecutar una consulta con medición de tiempo
export async function queryWithTiming<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; duration: number; rowCount: number }> {
  const start = performance.now();
  const result = await pool.query(text, params);
  const duration = performance.now() - start;
  
  return {
    rows: result.rows as T[],
    duration,
    rowCount: result.rowCount || 0,
  };
}

// Función para ejecutar EXPLAIN ANALYZE y capturar el plan
export async function explainAnalyze(text: string): Promise<string> {
  const result = await pool.query(`EXPLAIN ANALYZE ${text}`);
  return result.rows.map((row: any) => row['QUERY PLAN']).join('\n');
}

// Función para cerrar el pool
export async function closePool() {
  await pool.end();
}

// Función para verificar conexión
export async function testConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Error de conexión:', error);
    return false;
  }
}
