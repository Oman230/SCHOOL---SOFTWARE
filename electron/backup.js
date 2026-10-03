const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const BACKUP_PREFIX = 'school-backup-';
const RETAINED_DAILY_BACKUPS = 30;
const POSTGRES_BACKUP_FORMAT = 'sunrise-school-postgres-backup';
const POSTGRES_TABLES = [
  'admins', 'admission_applications', 'classrooms', 'subjects', 'teachers', 'students',
  'attendance_records', 'assignments', 'announcements', 'school_fees', 'reports', 'report_scores', 'payments',
];

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error('Invalid database identifier in backup.');
  return `"${identifier}"`;
}

function parsePostgresBackup(contents) {
  let backup;
  try {
    backup = JSON.parse(contents);
  } catch {
    throw new Error('The selected file is not a valid school database backup.');
  }
  if (backup?.format !== POSTGRES_BACKUP_FORMAT || backup.version !== 1 || !Array.isArray(backup.tables)) {
    throw new Error('The selected file is not a valid school database backup.');
  }

  const names = new Set();
  for (const table of backup.tables) {
    if (!POSTGRES_TABLES.includes(table?.name) || names.has(table.name)
      || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      throw new Error('The selected file is not a valid school database backup.');
    }
    names.add(table.name);
    const columns = new Set();
    for (const column of table.columns) {
      if (!column || typeof column.name !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(column.name)
        || typeof column.dataType !== 'string' || columns.has(column.name)) {
        throw new Error('The selected file is not a valid school database backup.');
      }
      columns.add(column.name);
    }
    for (const row of table.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || Object.keys(row).some((key) => !columns.has(key))) {
        throw new Error('The selected file is not a valid school database backup.');
      }
    }
  }
  if (!names.has('admins') || !names.has('students')) {
    throw new Error('The selected file is not a valid school database backup.');
  }
  return backup;
}

function validatePostgresBackupFile(sourcePath) {
  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
    throw new Error('The selected backup file does not exist.');
  }
  parsePostgresBackup(fs.readFileSync(resolvedSource, 'utf8'));
  return resolvedSource;
}

async function createPostgresBackup(pool, destination) {
  const resolvedDestination = path.resolve(destination);
  const temporaryPath = `${resolvedDestination}.tmp-${process.pid}-${Date.now()}`;
  const previousPath = `${resolvedDestination}.previous-${process.pid}-${Date.now()}`;
  const client = await pool.connect();
  let movedPrevious = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query(`
      SELECT table_name, column_name, data_type, is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `, [POSTGRES_TABLES]);
    const metadata = new Map();
    for (const column of result.rows) {
      if (!metadata.has(column.table_name)) metadata.set(column.table_name, []);
      if (column.is_generated === 'NEVER') {
        metadata.get(column.table_name).push({ name: column.column_name, dataType: column.data_type });
      }
    }

    const tables = [];
    for (const name of POSTGRES_TABLES) {
      const columns = metadata.get(name);
      if (!columns) continue;
      const selectedColumns = columns.map((column) => quoteIdentifier(column.name)).join(', ');
      const rows = await client.query(`SELECT ${selectedColumns} FROM public.${quoteIdentifier(name)}`);
      tables.push({ name, columns, rows: rows.rows });
    }
    if (!metadata.has('admins') || !metadata.has('students')) {
      throw new Error('The shared database does not have the school schema required for backups.');
    }

    fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify({
      format: POSTGRES_BACKUP_FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      tables,
    }));
    await client.query('COMMIT');
    if (fs.existsSync(resolvedDestination)) {
      fs.renameSync(resolvedDestination, previousPath);
      movedPrevious = true;
    }
    fs.renameSync(temporaryPath, resolvedDestination);
    if (movedPrevious) fs.rmSync(previousPath, { force: true });
    return resolvedDestination;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (movedPrevious && !fs.existsSync(resolvedDestination)) fs.renameSync(previousPath, resolvedDestination);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  } finally {
    client.release();
  }
}

async function restorePostgresBackup(pool, sourcePath) {
  const resolvedSource = validatePostgresBackupFile(sourcePath);
  const backup = parsePostgresBackup(fs.readFileSync(resolvedSource, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT table_name, column_name, data_type, is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `, [POSTGRES_TABLES]);
    const metadata = new Map();
    for (const column of result.rows) {
      if (!metadata.has(column.table_name)) metadata.set(column.table_name, new Map());
      metadata.get(column.table_name).set(column.column_name, column);
    }
    if (!metadata.has('admins') || !metadata.has('students')) {
      throw new Error('The shared database does not have the school schema required for backups.');
    }

    for (const table of backup.tables) {
      const currentColumns = metadata.get(table.name);
      if (!currentColumns || table.columns.some((column) => {
        const current = currentColumns.get(column.name);
        return !current || current.is_generated !== 'NEVER';
      })) {
        throw new Error(`The backup table ${table.name} does not match this app version.`);
      }
    }

    const tableNames = POSTGRES_TABLES.filter((name) => metadata.has(name));
    const quotedTables = tableNames.map((name) => `public.${quoteIdentifier(name)}`).join(', ');
    await client.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
    const savedTables = new Map(backup.tables.map((table) => [table.name, table]));
    for (const name of tableNames) {
      const table = savedTables.get(name);
      if (!table) continue;
      const columns = table.columns;
      const quotedColumns = columns.map((column) => quoteIdentifier(column.name)).join(', ');
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      for (const row of table.rows) {
        const values = columns.map((column) => {
          const value = row[column.name];
          return value !== null && ['json', 'jsonb'].includes(column.dataType) ? JSON.stringify(value) : value;
        });
        await client.query(`INSERT INTO public.${quoteIdentifier(name)} (${quotedColumns}) VALUES (${placeholders})`, values);
      }
      if (columns.some((column) => column.name === 'id')) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM public.${quoteIdentifier(name)}`,
          [`public.${name}`]
        );
      }
    }
    await client.query('COMMIT');
    return { restored: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

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

function restoreSqliteBackup(database, sourcePath) {
  const resolvedSource = validateBackupFile(sourcePath);
  const source = new Database(resolvedSource, { readonly: true, fileMustExist: true });
  const sourceTables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  source.close();

  database.pragma('foreign_keys = OFF');
  database.prepare('ATTACH DATABASE ? AS incoming_backup').run(resolvedSource);
  try {
    const currentTables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
    const quotedTables = currentTables.map(quoteIdentifier);
    const restore = database.transaction(() => {
      for (const table of [...quotedTables].reverse()) database.exec(`DELETE FROM ${table}`);
      for (const tableName of sourceTables) {
        if (!currentTables.includes(tableName)) continue;
        const table = quoteIdentifier(tableName);
        const sourceColumns = database.prepare(`PRAGMA incoming_backup.table_info(${table})`).all().map((column) => column.name);
        const currentColumns = database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
        const columns = sourceColumns.filter((column) => currentColumns.includes(column));
        if (!columns.length) continue;
        const names = columns.map(quoteIdentifier).join(', ');
        database.exec(`INSERT INTO ${table} (${names}) SELECT ${names} FROM incoming_backup.${table}`);
      }
      const violations = database.pragma('foreign_key_check');
      if (violations.length) throw new Error('The selected backup contains records with invalid relationships.');
    });
    restore();
    return { restored: true };
  } finally {
    database.exec('DETACH DATABASE incoming_backup');
    database.pragma('foreign_keys = ON');
  }
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
  createPostgresBackup,
  parsePostgresBackup,
  restorePostgresBackup,
  restoreSqliteBackup,
  validatePostgresBackupFile,
  validateBackupFile,
};