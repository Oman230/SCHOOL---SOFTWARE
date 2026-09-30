const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createCloudSync, normalizeNeonConnectionString, testNeonConnection } = require('../../electron/cloud-sync');

test('Neon SSL modes are normalized to explicit full certificate verification', () => {
  const original = 'postgresql://unit-test:secret@example.invalid/db?sslmode=require&channel_binding=require';
  const normalized = new URL(normalizeNeonConnectionString(original));
  assert.equal(normalized.searchParams.get('sslmode'), 'verify-full');
  assert.equal(normalized.searchParams.get('channel_binding'), 'require');
  assert.equal(new URL(original).searchParams.get('sslmode'), 'require');
  assert.equal(normalizeNeonConnectionString('postgresql://unit-test/db?sslmode=verify-full'), 'postgresql://unit-test/db?sslmode=verify-full');
});

test('Neon connection test connects and executes a harmless query', async () => {
  const calls = [];
  class TestClient {
    constructor(options) {
      calls.push(['construct', options.connectionString]);
    }

    async connect() { calls.push(['connect']); }
    async query(sql) { calls.push(['query', sql]); }
    async end() { calls.push(['end']); }
  }

  assert.equal(await testNeonConnection('postgresql://unit-test', TestClient), true);
  assert.deepEqual(calls, [
    ['construct', 'postgresql://unit-test'],
    ['connect'],
    ['query', 'SELECT 1'],
    ['end'],
  ]);
});

class MemoryCloud {
  constructor() {
    this.snapshots = [];
  }

  async query(sql, values = []) {
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.includes('SELECT revision, snapshot, sha256')) {
      const row = this.snapshots.at(-1);
      return { rows: row ? [{ ...row, snapshot: Buffer.from(row.snapshot) }] : [] };
    }
    if (sql.includes('INSERT INTO sunrise_school_sync_snapshot')) {
      const [revision, snapshot, hash] = values;
      if (this.snapshots.length) return { rows: [] };
      this.snapshots = [{ revision, snapshot: Buffer.from(snapshot), sha256: hash }];
      return { rows: [{ revision }] };
    }
    if (sql.includes('UPDATE sunrise_school_sync_snapshot')) {
      const [revision, snapshot, hash, expectedRevision] = values;
      if (this.snapshots.at(-1)?.revision !== expectedRevision) return { rows: [] };
      this.snapshots = [{ revision, snapshot: Buffer.from(snapshot), sha256: hash }];
      return { rows: [{ revision }] };
    }
    throw new Error(`Unexpected cloud query: ${sql}`);
  }

  async end() {}
}

function createSchoolDatabase(filename, studentName) {
  const database = new Database(filename);
  database.exec(`
    CREATE TABLE admins (id INTEGER PRIMARY KEY);
    CREATE TABLE students (id INTEGER PRIMARY KEY, full_name TEXT);
  `);
  if (studentName) database.prepare('INSERT INTO students (full_name) VALUES (?)').run(studentName);
  return database;
}

test('Neon snapshot sync uploads offline changes and restores onto an empty device', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'school-cloud-sync-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const cloud = new MemoryCloud();
  const primaryPath = path.join(folder, 'primary.sqlite');
  const primaryDatabase = createSchoolDatabase(primaryPath, 'Student One');
  const primarySync = createCloudSync({
    database: { database: primaryDatabase },
    databasePath: primaryPath,
    userDataPath: path.join(folder, 'primary-data'),
    connectionString: 'postgresql://test',
    pool: cloud,
  });

  assert.equal((await primarySync.syncNow()).cloudRevision, 1);
  primaryDatabase.prepare('INSERT INTO students (full_name) VALUES (?)').run('Student Two');
  assert.equal((await primarySync.syncNow()).cloudRevision, 2);

  const newDevicePath = path.join(folder, 'new-device.sqlite');
  const newDeviceDatabase = createSchoolDatabase(newDevicePath);
  const newDeviceSync = createCloudSync({
    database: { database: newDeviceDatabase },
    databasePath: newDevicePath,
    userDataPath: path.join(folder, 'new-device-data'),
    connectionString: 'postgresql://test',
    pool: cloud,
  });

  const result = await newDeviceSync.syncNow({ allowPull: true });
  assert.equal(result.restartRequired, true);
  const restoredDatabase = new Database(newDevicePath, { readonly: true });
  assert.deepEqual(
    restoredDatabase.prepare('SELECT full_name FROM students ORDER BY id').all().map((row) => row.full_name),
    ['Student One', 'Student Two']
  );
  restoredDatabase.close();

  const reopenedDatabase = new Database(newDevicePath);
  const restartedSync = createCloudSync({
    database: { database: reopenedDatabase },
    databasePath: newDevicePath,
    userDataPath: path.join(folder, 'new-device-data'),
    connectionString: 'postgresql://test',
    pool: cloud,
  });
  const restartResult = await restartedSync.syncNow({ allowPull: true });
  assert.equal(restartResult.state, 'synced');
  assert.equal(restartResult.cloudRevision, 2);

  primaryDatabase.prepare('INSERT INTO students (full_name) VALUES (?)').run('Offline change');
  const otherPath = path.join(folder, 'other-device.sqlite');
  const otherDatabase = createSchoolDatabase(otherPath, 'Other device change');
  const otherSync = createCloudSync({
    database: { database: otherDatabase },
    databasePath: otherPath,
    userDataPath: path.join(folder, 'other-device-data'),
    connectionString: 'postgresql://test',
    pool: cloud,
  });
  assert.equal((await otherSync.publishLocalSnapshot()).cloudRevision, 3);
  const conflict = await primarySync.syncNow();
  assert.equal(conflict.state, 'conflict');
  assert.equal(conflict.cloudRevision, 3);

  otherDatabase.close();
  reopenedDatabase.close();
  await restartedSync.close();
  await otherSync.close();
  await primarySync.close();
  await newDeviceSync.close();
});