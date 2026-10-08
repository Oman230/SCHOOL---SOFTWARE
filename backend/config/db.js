const fs = require('fs');
const path = require('path');
require('dotenv').config();

const isTestEnvironment = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);

function shouldUsePostgres(environment = process.env, isTesting = isTestEnvironment) {
  return !isTesting && (environment.DB_DRIVER === 'postgres'
    || (environment.ELECTRON_APP !== 'true'
      && environment.DB_DRIVER !== 'sqlite'
      && Boolean(environment.DATABASE_URL)));
}

const usePostgres = shouldUsePostgres();

if (usePostgres) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when using the Postgres database driver.');
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', (error) => console.error('[Postgres] Idle client error:', error));

  module.exports = {
    driver: 'postgres',
    query: (text, params) => pool.query(text, params),
    connect: () => pool.connect(),
    end: () => pool.end(),
    schemaReady: async () => {
      await pool.query('SELECT 1 FROM admins LIMIT 0');
      await pool.query('CREATE TABLE IF NOT EXISTS student_id_sequences (year INTEGER PRIMARY KEY, last_number INTEGER NOT NULL)');
      await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20)');
      await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS classroom_name VARCHAR(100)');
      await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'paystack'");
      await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS classroom_name VARCHAR(100)');
      await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS promotion_status VARCHAR(30)');
      await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS attitude_values_competencies TEXT');
    },
    database: null,
    databasePath: null,
    getPool: () => pool,
    shouldUsePostgres,
  };
} else {
  const Database = require('better-sqlite3');
  const databasePath = path.resolve(process.env.SCHOOL_DB_PATH || path.join(__dirname, '..', 'database', 'school.sqlite'));
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sqlite.sql');
  database.exec(fs.readFileSync(schemaPath, 'utf8'));
  const paymentColumns = new Set(database.prepare('PRAGMA table_info(payments)').all().map((column) => column.name));
  if (!paymentColumns.has('academic_year')) {
    database.exec('ALTER TABLE payments ADD COLUMN academic_year TEXT');
  }
  if (!paymentColumns.has('classroom_name')) {
    database.exec('ALTER TABLE payments ADD COLUMN classroom_name TEXT');
  }
  if (!paymentColumns.has('payment_method')) {
    database.exec("ALTER TABLE payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'paystack'");
  }
  const reportColumns = new Set(database.prepare('PRAGMA table_info(reports)').all().map((column) => column.name));
  if (!reportColumns.has('classroom_name')) {
    database.exec('ALTER TABLE reports ADD COLUMN classroom_name TEXT');
  }
  if (!reportColumns.has('promotion_status')) {
    database.exec('ALTER TABLE reports ADD COLUMN promotion_status TEXT');
  }
  if (!reportColumns.has('attitude_values_competencies')) {
    database.exec('ALTER TABLE reports ADD COLUMN attitude_values_competencies TEXT');
  }

  function normalizeValue(value) {
    if (typeof value === 'boolean') return Number(value);
    return value;
  }

  function prepareQuery(sql, values = []) {
    const arrayParameters = new Map();
    let arrayParameterIndex = 0;
    const parameters = [];
    const normalizedSql = sql
      .replace(/::(?:jsonb|date|int\[\])/gi, '')
      .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP')
      .replace(/=\s*ANY\(\s*\$(\d+)\s*\)/gi, (_, index) => {
        const marker = `__SQL_ARRAY_${arrayParameterIndex++}__`;
        arrayParameters.set(marker, values[Number(index) - 1] || []);
        return `IN (${marker})`;
      })
      .replace(/(__SQL_ARRAY_\d+__)|(\$(\d+))/g, (_, marker, placeholder, index) => {
        if (marker) {
          const items = arrayParameters.get(marker);
          parameters.push(...items.map(normalizeValue));
          return items.length ? items.map(() => '?').join(', ') : 'SELECT NULL WHERE 0';
        }
        parameters.push(normalizeValue(values[Number(index) - 1]));
        return '?';
      });
    return { sql: normalizedSql, parameters };
  }

  function parseRow(row) {
    if (typeof row.attachments === 'string') {
      try {
        row.attachments = JSON.parse(row.attachments);
      } catch {
        row.attachments = [];
      }
    }
    return row;
  }

  function createQuery(connection) {
    return async function query(text, values = []) {
      const { sql, parameters } = prepareQuery(text, values);
      const statement = connection.prepare(sql);
      if (statement.reader) {
        const rows = statement.all(...parameters).map(parseRow);
        return { rows, rowCount: rows.length };
      }

      const result = statement.run(...parameters);
      return {
        rows: [],
        rowCount: result.changes,
        lastID: result.lastInsertRowid,
        lastInsertRowid: result.lastInsertRowid,
      };
    };
  }

  module.exports = {
    driver: 'sqlite',
    query: createQuery(database),
    async connect() {
      const connection = new Database(databasePath);
      connection.pragma('foreign_keys = ON');
      return {
        query: createQuery(connection),
        release() {
          if (connection.open) connection.close();
        },
      };
    },
    async end() {
      if (database.open) database.close();
    },
    schemaReady: async () => {},
    database,
    databasePath,
    prepareQuery,
    shouldUsePostgres,
  };
}