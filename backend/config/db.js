const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

const databasePath = path.resolve(process.env.SCHOOL_DB_PATH || path.join(__dirname, '..', 'database', 'school.sqlite'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma('foreign_keys = ON');
database.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sqlite.sql'), 'utf8'));

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
    .replace(/(__SQL_ARRAY_\d+__)|\$(\d+)/g, (_, marker, index) => {
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
    } catch (error) {
      row.attachments = [];
    }
  }
  return row;
}

function createQuery(connection) {
  return async function query(sql, values = []) {
    const prepared = prepareQuery(sql, values);
    const statement = connection.prepare(prepared.sql);
    if (statement.reader) {
      const rows = statement.all(...prepared.parameters).map(parseRow);
      return { rows, rowCount: rows.length };
    }

    const result = statement.run(...prepared.parameters);
    return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
  };
}

const query = createQuery(database);
const pool = {
  query,
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
};

module.exports = pool;
