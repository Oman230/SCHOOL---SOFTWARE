const fs = require('fs');
const os = require('os');
const path = require('path');
const database = require('../config/db');
const {
  createBackup,
  createPostgresBackup,
  restorePostgresBackup,
  restoreSqliteBackup,
  validateBackupFile,
  validatePostgresBackupFile,
} = require('../../electron/backup');

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'school-admin-backup-'));
}

async function exportDatabase(req, res) {
  const directory = createTemporaryDirectory();
  const isPostgres = database.driver === 'postgres';
  const filename = `school-backup-${new Date().toISOString().slice(0, 10)}.${isPostgres ? 'schoolbackup' : 'sqlite'}`;
  const backupPath = path.join(directory, filename);
  try {
    if (isPostgres) await createPostgresBackup(database.getPool(), backupPath);
    else await createBackup(database.database, backupPath);
    res.set('Cache-Control', 'no-store');
    res.download(backupPath, filename, (error) => {
      fs.rmSync(directory, { recursive: true, force: true });
      if (error && !res.headersSent) res.status(500).json({ message: 'Could not download the database backup.' });
    });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    console.error('Export admin database backup error:', error);
    res.status(500).json({ message: 'Could not create the database backup.' });
  }
}

async function importDatabase(req, res) {
  const directory = createTemporaryDirectory();
  const isPostgres = database.driver === 'postgres';
  const backupPath = path.join(directory, `school-import.${isPostgres ? 'schoolbackup' : 'sqlite'}`);
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ message: 'Choose a non-empty database backup file.' });
    }
    fs.writeFileSync(backupPath, req.body, { mode: 0o600 });
    if (isPostgres) {
      validatePostgresBackupFile(backupPath);
      await restorePostgresBackup(database.getPool(), backupPath);
    } else {
      validateBackupFile(backupPath);
      restoreSqliteBackup(database.database, backupPath);
    }
    res.json({ restored: true, message: 'Backup imported successfully.' });
  } catch (error) {
    console.error('Import admin database backup error:', error);
    res.status(400).json({ message: error.message || 'Could not import the database backup.' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { exportDatabase, importDatabase };