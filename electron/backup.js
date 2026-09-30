const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const BACKUP_PREFIX = 'school-backup-';
const RETAINED_DAILY_BACKUPS = 30;

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function backupPath(folder, date = new Date()) {
  return path.join(folder, `${BACKUP_PREFIX}${dateKey(date)}.sqlite`);
}

async function createBackup(database, destination) {
  const resolvedDestination = path.resolve(destination);
  if (resolvedDestination === path.resolve(database.name)) {
    throw new Error('The backup destination cannot be the active database.');
  }

  fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
  const temporaryPath = `${resolvedDestination}.tmp-${process.pid}-${Date.now()}`;
  const previousPath = `${resolvedDestination}.previous-${process.pid}-${Date.now()}`;
  let movedPrevious = false;
  try {
    await database.backup(temporaryPath);
    if (fs.existsSync(resolvedDestination)) {
      fs.renameSync(resolvedDestination, previousPath);
      movedPrevious = true;
    }
    fs.renameSync(temporaryPath, resolvedDestination);
    if (movedPrevious) fs.rmSync(previousPath, { force: true });
    return resolvedDestination;
  } catch (error) {
    if (movedPrevious && !fs.existsSync(resolvedDestination)) {
      fs.renameSync(previousPath, resolvedDestination);
    }
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function validateBackupFile(sourcePath) {
  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
    throw new Error('The selected backup file does not exist.');
  }

  let source;
  try {
    source = new Database(resolvedSource, { readonly: true, fileMustExist: true });
    const integrity = source.pragma('integrity_check', { simple: true });
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    if (integrity !== 'ok' || !tables.includes('students') || !tables.includes('admins')) {
      throw new Error('The selected file is not a valid school database backup.');
    }
  } catch (error) {
    if (error.message === 'The selected file is not a valid school database backup.') throw error;
    throw new Error(`Could not read this SQLite backup: ${error.message}`);
  } finally {
    if (source?.open) source.close();
  }

  return resolvedSource;
}

async function installBackup(database, sourcePath, databasePath) {
  const resolvedSource = validateBackupFile(sourcePath);
  const resolvedDatabase = path.resolve(databasePath);
  if (resolvedSource === resolvedDatabase) {
    throw new Error('Choose a backup file other than the active database.');
  }

  const stagedPath = `${resolvedDatabase}.restore-${process.pid}-${Date.now()}`;
  const safetyPath = `${resolvedDatabase}.before-restore-${Date.now()}`;
  const source = new Database(resolvedSource, { readonly: true, fileMustExist: true });
  try {
    await source.backup(stagedPath);
  } finally {
    source.close();
  }

  if (database.open) database.close();
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${resolvedDatabase}${suffix}`, { force: true });

  let movedCurrentDatabase = false;
  try {
    if (fs.existsSync(resolvedDatabase)) {
      fs.renameSync(resolvedDatabase, safetyPath);
      movedCurrentDatabase = true;
    }
    fs.renameSync(stagedPath, resolvedDatabase);
  } catch (error) {
    if (movedCurrentDatabase && !fs.existsSync(resolvedDatabase)) {
      fs.renameSync(safetyPath, resolvedDatabase);
    }
    fs.rmSync(stagedPath, { force: true });
    throw error;
  }

  return safetyPath;
}

function pruneDailyBackups(folder) {
  if (!fs.existsSync(folder)) return;
  const backups = fs.readdirSync(folder)
    .filter((filename) => /^school-backup-\d{4}-\d{2}-\d{2}\.sqlite$/.test(filename))
    .sort()
    .reverse();
  for (const filename of backups.slice(RETAINED_DAILY_BACKUPS)) {
    fs.rmSync(path.join(folder, filename), { force: true });
  }
}

async function createDailyBackups(database, userDataPath, externalFolder, date = new Date()) {
  const folders = [{ path: path.join(userDataPath, 'backups'), external: false }];
  if (externalFolder && path.resolve(externalFolder) !== path.resolve(folders[0].path)) {
    folders.push({ path: externalFolder, external: true });
  }

  const destinations = [];
  for (const folder of folders) {
    if (folder.external && (!fs.existsSync(folder.path) || !fs.statSync(folder.path).isDirectory())) continue;
    fs.mkdirSync(folder.path, { recursive: true });
    const destination = backupPath(folder.path, date);
    if (!fs.existsSync(destination)) destinations.push(await createBackup(database, destination));
    pruneDailyBackups(folder.path);
  }
  return destinations;
}

module.exports = {
  backupPath,
  createBackup,
  createDailyBackups,
  installBackup,
  validateBackupFile,
};