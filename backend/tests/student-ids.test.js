const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { generateStudentId } = require('../security/studentIds');

function createTestPool() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE students (student_id_number TEXT PRIMARY KEY);
    INSERT INTO students (student_id_number) VALUES ('SIS-2026-003'), ('LEGACY-12');
  `);

  return {
    database,
    async query(sql, values = []) {
      const parameters = [];
      const statement = database.prepare(sql.replace(/\$(\d+)/g, (_, index) => {
        parameters.push(values[Number(index) - 1]);
        return '?';
      }));
      if (statement.reader) {
        const rows = statement.all(...parameters);
        return { rows, rowCount: rows.length };
      }
      const result = statement.run(...parameters);
      return { rows: [], rowCount: result.changes };
    },
  };
}

test('student IDs continue after existing school IDs and sequence safely for concurrent additions', async () => {
  const pool = createTestPool();
  try {
    const ids = await Promise.all([
      generateStudentId(pool, 2026),
      generateStudentId(pool, 2026),
      generateStudentId(pool, 2026),
    ]);

    assert.deepEqual(ids.sort(), ['SIS-2026-004', 'SIS-2026-005', 'SIS-2026-006']);
    assert.equal(await generateStudentId(pool, 2027), 'SIS-2027-001');
  } finally {
    pool.database.close();
  }
});
