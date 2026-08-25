import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { pool, closePool } from './db.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuración de conexión (sobreescribible por variables de entorno)
// Default: Docker compose del lab (postgres:16 en localhost:55434, user postgres, pass lab)
const pgHost = process.env.LAB_PGHOST || 'localhost';
const pgPort = parseInt(process.env.LAB_PGPORT || '55434');
const pgUser = process.env.LAB_PGUSER || 'postgres';
const pgPassword = process.env.LAB_PGPASSWORD || 'lab';
const targetDb = process.env.LAB_PGDATABASE || 'lab_query_performance';

async function setup(fresh: boolean = false) {
  // ─────────────────────────────────────────────────────────────
  // 1. Asegurar que la base objetivo existe ANTES de conectar a ella
  //    (conectamos a la base de mantenimiento 'postgres' primero)
  // ─────────────────────────────────────────────────────────────
  console.log('🔄 Verificando base de datos...');
  const tempPool = new pg.Pool({
    host: pgHost,
    port: pgPort,
    user: pgUser,
    password: pgPassword,
    database: 'postgres',
  });
  const tempClient = await tempPool.connect();

  try {
    if (fresh) {
      console.log('🔄 Reinicio limpio: eliminando base de datos...');

      // Terminar conexiones existentes
      await tempClient.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [targetDb]);

      // Eliminar y recrear la base
      await tempClient.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(targetDb)}`);
      console.log(`  ✅ Base "${targetDb}" eliminada`);
    }

    // Crear la base si no existe
    const existsResult = await tempClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb]
    );

    if (existsResult.rows.length === 0) {
      await tempClient.query(`CREATE DATABASE ${pg.escapeIdentifier(targetDb)}`);
      console.log(`  ✅ Base "${targetDb}" creada`);
    } else {
      console.log(`  ✅ Base "${targetDb}" ya existe`);
    }
  } finally {
    tempClient.release();
    await tempPool.end();
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Conectar a la base objetivo y aplicar la migración
  //    (ahora la base sí existe)
  // ─────────────────────────────────────────────────────────────
  const client = await pool.connect();

  try {
    // Aplicar migración
    console.log('📋 Aplicando migración 001_schema.sql...');
    const migrationSQL = readFileSync(
      join(__dirname, '..', 'migrations', '001_schema.sql'),
      'utf-8'
    );
    await client.query(migrationSQL);
    console.log('✅ Migración aplicada');

    // Verificar estructura
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'large_table'
      ORDER BY ordinal_position
    `);

    console.log('\n📊 Estructura de la tabla large_table:');
    console.log('─'.repeat(50));
    result.rows.forEach((row: any) => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });
    console.log('─'.repeat(50));

  } catch (error) {
    console.error('❌ Error durante el setup:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Ejecutar si se llama directamente
const args = process.argv.slice(2);
const fresh = args.includes('--fresh');

setup(fresh)
  .then(() => {
    console.log('\n✅ Setup completado exitosamente');
    closePool();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Setup falló:', error);
    closePool();
    process.exit(1);
  });