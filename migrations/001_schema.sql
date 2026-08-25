-- LAB-03 Query Performance
-- Migración 001: Esquema de la tabla para experimentos de rendimiento

-- Eliminar tabla si existe (para reinicio limpio)
DROP TABLE IF EXISTS large_table;

-- Crear tabla principal
CREATE TABLE large_table (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  value NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Comentarios para documentación
COMMENT ON TABLE large_table IS 'Tabla para experimentos de rendimiento de consultas PostgreSQL';
COMMENT ON COLUMN large_table.id IS 'Clave primaria autoincremental';
COMMENT ON COLUMN large_table.name IS 'Nombre descriptivo del registro';
COMMENT ON COLUMN large_table.category IS 'Categoría para filtros y agrupaciones';
COMMENT ON COLUMN large_table.value IS 'Valor numérico para rangos y agregaciones';
COMMENT ON COLUMN large_table.created_at IS 'Timestamp de creación para ordenamiento temporal';

-- Índices básicos (se crearán índices adicionales en los experimentos)
-- Índice en created_at para ordenamiento temporal
CREATE INDEX idx_large_table_created_at ON large_table(created_at);

-- NOTA: NO se crea índice en category (ese es el punto del experimento)
-- Los índices en category, value, etc. se crearán durante los experimentos
