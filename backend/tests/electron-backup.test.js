const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  createBackup,
  createDailyBackups,
  createPostgresBackup,
  installBackup,
  parsePostgresBackup,
  restorePostgresBackup,
  validateBackupFile,
} = require('../../electron/backup');

function createSchoolDatabase(filename, studentName) {
  const database = new Database(filename);
  database.exec(`
    CREATE TABLE admins (id INTEGER PRIMARY KEY);
    CREATE TABLE students (id INTEGER PRIMARY KEY, full_name TEXT);
  `);
  database.prepare('INSERT INTO students (full_name) VALUES (?)').run(studentName);
  return database;
}

function createFakePostgresPool(calls) {
  const metadata = [
    { table_name: 'admins', column_name: 'id', data_type: 'integer', is_generated: 'NEVER' },
    { table_name: 'admins', column_name: 'password_hash', data_type: 'character varying', is_generated: 'NEVER' },
    { table_name: 'students', column_name: 'id', data_type: 'integer', is_generated: 'NEVER' },
    { table_name: 'students', column_name: 'full_name', data_type: 'text', is_generated: 'NEVER' },
  ];
  const rowsByTable = {
    admins: [{ id: 1, password_hash: 'hashed-password' }],
    students: [{ id: 2, full_name: 'Student One' }],
  };
  return {
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push({ sql, values });
          if (sql.includes('FROM information_schema.columns')) return { rows: metadata };
          const table = sql.match(/FROM public\."([a-z_]+)"/i)?.[1];
          if (sql.startsWith('SELECT') && table) return { rows: rowsByTable[table] };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

test('school database backup validates and can restore the previous database safely', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'school-backup-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));

  const activePath = path.join(folder, 'school.sqlite');
  const exportedPath = path.join(folder, 'export.sqlite');
  const activeDatabase = createSchoolDatabase(activePath, 'Current student');
  await createBackup(activeDatabase, exportedPath);

  assert.equal(validateBackupFile(exportedPath), exportedPath);
  const incomingPath = path.join(folder, 'incoming.sqlite');
  const importedDatabase = createSchoolDatabase(incomingPath, 'Restored student');
  importedDatabase.close();

  const safetyPath = await installBackup(activeDatabase, incomingPath, activePath);
  assert.equal(fs.existsSync(safetyPath), true);
  const restoredDatabase = new Database(activePath, { readonly: true });
  assert.equal(restoredDatabase.prepare('SELECT full_name FROM students').get().full_name, 'Restored student');
  restoredDatabase.close();

  const preservedDatabase = new Database(safetyPath, { readonly: true });
  assert.equal(preservedDatabase.prepare('SELECT full_name FROM students').get().full_name, 'Current student');
  preservedDatabase.close();
});

test('backup validation rejects non-school SQLite databases', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'school-backup-invalid-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const unrelatedPath = path.join(folder, 'unrelated.sqlite');
  const unrelatedDatabase = new Database(unrelatedPath);
  unrelatedDatabase.exec('CREATE TABLE notes (text TEXT)');
  unrelatedDatabase.close();

  assert.throws(() => validateBackupFile(unrelatedPath), /not a valid school database backup/);

  const activePath = path.join(folder, 'active.sqlite');
  const activeDatabase = createSchoolDatabase(activePath, 'Unchanged student');
  await assert.rejects(installBackup(activeDatabase, unrelatedPath, activePath));
  assert.equal(activeDatabase.open, true);
  activeDatabase.close();
});

test('daily backup keeps a local copy and does not recreate a disconnected external folder', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'school-backup-daily-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const database = createSchoolDatabase(path.join(folder, 'school.sqlite'), 'Daily student');
  const missingDrive = path.join(folder, 'unmounted-drive');

  const destinations = await createDailyBackups(database, path.join(folder, 'user-data'), missingDrive, new Date('2026-09-30T12:00:00Z'));
  database.close();

  assert.equal(destinations.length, 1);
  assert.equal(fs.existsSync(path.join(folder, 'user-data', 'backups', 'school-backup-2026-09-30.sqlite')), true);
  assert.equal(fs.existsSync(missingDrive), false);
});

test('shared PostgreSQL backup exports and restores school records', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'school-postgres-backup-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const backupPath = path.join(folder, 'school.schoolbackup');
  const exportCalls = [];
  const exportPool = createFakePostgresPool(exportCalls);

  await createPostgresBackup(exportPool, backupPath);
  const backup = parsePostgresBackup(fs.readFileSync(backupPath, 'utf8'));
  assert.deepEqual(backup.tables.map((table) => table.name), ['admins', 'students']);
  assert.equal(backup.tables[0].rows[0].password_hash, 'hashed-password');

  const restoreCalls = [];
  const restorePool = createFakePostgresPool(restoreCalls);
  await restorePostgresBackup(restorePool, backupPath);
  assert.equal(restoreCalls.some(({ sql }) => sql.startsWith('TRUNCATE TABLE')), true);
  assert.equal(restoreCalls.filter(({ sql }) => sql.startsWith('INSERT INTO')).length, 2);
  assert.equal(restoreCalls.at(-1).sql, 'COMMIT');
});

test('shared PostgreSQL backup validation rejects unrecognized formats', () => {
  assert.throws(() => parsePostgresBackup('{"format":"other","tables":[]}'), /not a valid school database backup/);
});