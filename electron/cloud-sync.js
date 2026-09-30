const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createBackup, installBackup, validateBackupFile } = require('./backup');

const SNAPSHOT_TABLE = 'sunrise_school_sync_snapshot';

function normalizeNeonConnectionString(connectionString) {
  if (!connectionString) return connectionString;
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get('sslmode');
  if (['prefer', 'require', 'verify-ca'].includes(sslMode)) {
    url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  }
  return connectionString;
}

async function testNeonConnection(connectionString, ClientClass) {
  if (!connectionString) throw new Error('NEON_DATABASE_URL or DATABASE_URL is not configured.');
  const Client = ClientClass || require('pg').Client;
  const client = new Client({
    connectionString: normalizeNeonConnectionString(connectionString),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } finally {
    await client.end();
  }
}

function createCloudSync({ database, databasePath, userDataPath, connectionString, pool }) {
  const statePath = path.join(userDataPath, 'neon-sync-state.json');
  let connectionPool = pool || null;
  let syncInProgress = false;
  let status = {
    configured: Boolean(connectionString || pool),
    state: connectionString || pool ? 'checking' : 'not-configured',
    message: connectionString || pool
      ? 'Checking Neon connection.'
      : 'Neon sync is not configured. Add NEON_DATABASE_URL to the app settings.env file.',
    localRevision: null,
    cloudRevision: null,
    lastSyncedAt: null,
    restartRequired: false,
  };

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (error) {
      return null;
    }
  }

  function writeState(revision, hash) {
    fs.mkdirSync(userDataPath, { recursive: true });
    const temporaryPath = `${statePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ revision, hash, syncedAt: new Date().toISOString() }), { mode: 0o600 });
    if (fs.existsSync(statePath)) fs.rmSync(statePath, { force: true });
    fs.renameSync(temporaryPath, statePath);
  }

  function getPool() {
    if (!connectionPool) {
      const { Pool } = require('pg');
      connectionPool = new Pool({
        connectionString: normalizeNeonConnectionString(connectionString),
        ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        max: 1,
      });
      connectionPool.on('error', () => {
        setStatus('offline', 'Could not reach Neon. School records remain available in SQLite.');
      });
    }
    return connectionPool;
  }

  async function ensureSchema() {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        revision BIGINT NOT NULL,
        snapshot BYTEA NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async function getLatestSnapshot() {
    const result = await getPool().query(
      `SELECT revision, snapshot, sha256 FROM ${SNAPSHOT_TABLE} WHERE id = 1`
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return { revision: Number(row.revision), snapshot: row.snapshot, hash: row.sha256 };
  }

  async function getLocalSnapshot() {
    fs.mkdirSync(userDataPath, { recursive: true });
    const temporaryPath = path.join(userDataPath, `neon-sync-${process.pid}-${Date.now()}.sqlite`);
    try {
      await createBackup(database.database, temporaryPath);
      const snapshot = fs.readFileSync(temporaryPath);
      return { snapshot, hash: crypto.createHash('sha256').update(snapshot).digest('hex') };
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  function localDatabaseIsEmpty() {
    const names = new Set(database.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const userTables = [
      'admins', 'teachers', 'students', 'reports', 'report_scores', 'payments',
      'admission_applications', 'announcements', 'assignments', 'attendance_records', 'school_fees',
    ].filter((name) => names.has(name));
    return userTables.every((name) => database.database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count === 0);
  }

  async function publishSnapshot(snapshot, hash, expectedRevision) {
    const nextRevision = expectedRevision + 1;
    const result = expectedRevision === 0
      ? await getPool().query(`
        INSERT INTO ${SNAPSHOT_TABLE} (id, revision, snapshot, sha256)
        VALUES (1, $1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        RETURNING revision
      `, [nextRevision, snapshot, hash])
      : await getPool().query(`
        UPDATE ${SNAPSHOT_TABLE}
        SET revision = $1, snapshot = $2, sha256 = $3, created_at = NOW()
        WHERE id = 1 AND revision = $4
        RETURNING revision
      `, [nextRevision, snapshot, hash, expectedRevision]);

    if (!result.rows.length) return null;
    return nextRevision;
  }

  function setStatus(state, message, values = {}) {
    status = {
      ...status,
      state,
      message,
      restartRequired: false,
      ...values,
    };
    return { ...status };
  }

  async function restoreSnapshot(remote) {
    const temporaryPath = path.join(userDataPath, `neon-restore-${process.pid}-${Date.now()}.sqlite`);
    try {
      const snapshot = Buffer.from(remote.snapshot);
      const actualHash = crypto.createHash('sha256').update(snapshot).digest('hex');
      if (actualHash !== remote.hash) throw new Error('The cloud database snapshot failed its integrity check.');
      fs.writeFileSync(temporaryPath, snapshot, { mode: 0o600 });
      validateBackupFile(temporaryPath);
      await installBackup(database.database, temporaryPath, databasePath);
      writeState(remote.revision, remote.hash);
      return setStatus('synced', 'Downloaded the latest Neon snapshot. Restarting to load it.', {
        localRevision: remote.revision,
        cloudRevision: remote.revision,
        lastSyncedAt: new Date().toISOString(),
        restartRequired: true,
      });
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  async function syncNow({ allowPull = false } = {}) {
    if (!status.configured) return { ...status };
    if (syncInProgress) return { ...status, state: 'syncing', message: 'Neon sync is already running.' };
    syncInProgress = true;
    try {
      await ensureSchema();
      const [remote, local, localEmpty] = await Promise.all([
        getLatestSnapshot(),
        getLocalSnapshot(),
        Promise.resolve(localDatabaseIsEmpty()),
      ]);
      const state = readState();
      if (!remote) {
        if (state) return setStatus('conflict', 'Neon has no saved snapshot, but this device has sync history. No data was changed.');
        if (localEmpty) return setStatus('waiting-for-data', 'Neon is ready. The first school records will be uploaded after setup.');
        const revision = await publishSnapshot(local.snapshot, local.hash, 0);
        if (!revision) return setStatus('conflict', 'Another device initialized Neon at the same time. No data was overwritten.');
        writeState(revision, local.hash);
        return setStatus('synced', 'This computer uploaded the first school database snapshot.', {
          localRevision: revision,
          cloudRevision: revision,
          lastSyncedAt: new Date().toISOString(),
        });
      }

      if (!state) {
        if (localEmpty && allowPull) return restoreSnapshot(remote);
        if (localEmpty) return setStatus('cloud-update-available', 'School data is available in Neon and will download when the app starts.', {
          cloudRevision: remote.revision,
        });
        return setStatus('conflict', 'This computer and Neon both have data but are not linked. Choose which database to keep.', {
          cloudRevision: remote.revision,
        });
      }

      if (remote.revision < state.revision) {
        return setStatus('conflict', 'Neon is older than this computer’s last sync. No data was overwritten.', {
          localRevision: state.revision,
          cloudRevision: remote.revision,
        });
      }

      if (remote.revision === state.revision) {
        if (local.hash === remote.hash) {
          writeState(remote.revision, remote.hash);
          return setStatus('synced', 'This computer and Neon are up to date.', {
            localRevision: remote.revision,
            cloudRevision: remote.revision,
            lastSyncedAt: new Date().toISOString(),
          });
        }
        if (local.hash === state.hash) {
          if (allowPull) return restoreSnapshot(remote);
          return setStatus('cloud-update-available', 'A newer cloud database is ready to apply.', {
            localRevision: state.revision,
            cloudRevision: remote.revision,
          });
        }
        const revision = await publishSnapshot(local.snapshot, local.hash, remote.revision);
        if (!revision) return setStatus('conflict', 'Another device changed Neon during sync. No data was overwritten.', {
          localRevision: state.revision,
          cloudRevision: remote.revision,
        });
        writeState(revision, local.hash);
        return setStatus('synced', 'Offline school changes were uploaded to Neon.', {
          localRevision: revision,
          cloudRevision: revision,
          lastSyncedAt: new Date().toISOString(),
        });
      }

      if (local.hash === remote.hash) {
        writeState(remote.revision, remote.hash);
        return setStatus('synced', 'This computer and Neon are up to date.', {
          localRevision: remote.revision,
          cloudRevision: remote.revision,
          lastSyncedAt: new Date().toISOString(),
        });
      }
      if (local.hash === state.hash) {
        if (allowPull) return restoreSnapshot(remote);
        return setStatus('cloud-update-available', 'Another computer has newer data. Apply the cloud snapshot to update this computer.', {
          localRevision: state.revision,
          cloudRevision: remote.revision,
        });
      }
      return setStatus('conflict', 'This computer and another device both changed data. Choose which database to keep.', {
        localRevision: state.revision,
        cloudRevision: remote.revision,
      });
    } catch (error) {
      return setStatus('offline', 'Could not reach Neon. School records remain available in SQLite.');
    } finally {
      syncInProgress = false;
    }
  }

  async function applyCloudSnapshot() {
    if (!status.configured) throw new Error('Neon sync is not configured.');
    if (syncInProgress) throw new Error('A Neon sync is already running.');
    syncInProgress = true;
    try {
      await ensureSchema();
      const remote = await getLatestSnapshot();
      if (!remote) throw new Error('Neon does not contain a school database snapshot yet.');
      return await restoreSnapshot(remote);
    } finally {
      syncInProgress = false;
    }
  }

  async function publishLocalSnapshot() {
    if (!status.configured) throw new Error('Neon sync is not configured.');
    if (syncInProgress) throw new Error('A Neon sync is already running.');
    syncInProgress = true;
    try {
      await ensureSchema();
      const [remote, local] = await Promise.all([getLatestSnapshot(), getLocalSnapshot()]);
      const revision = await publishSnapshot(local.snapshot, local.hash, remote?.revision || 0);
      if (!revision) throw new Error('Neon changed during upload. Retry after checking the cloud status.');
      writeState(revision, local.hash);
      return setStatus('synced', 'This computer uploaded the latest Neon snapshot.', {
        localRevision: revision,
        cloudRevision: revision,
        lastSyncedAt: new Date().toISOString(),
      });
    } finally {
      syncInProgress = false;
    }
  }

  async function close() {
    if (connectionPool) await connectionPool.end();
  }

  return {
    applyCloudSnapshot,
    close,
    getStatus: () => ({ ...status }),
    publishLocalSnapshot,
    syncNow,
  };
}

module.exports = { createCloudSync, normalizeNeonConnectionString, testNeonConnection };