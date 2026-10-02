const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const jwt = require('jsonwebtoken');

app.setPath('userData', path.join(app.getPath('appData'), 'SunriseSchoolManagement'));

let server;
let mainWindow;
let backupTimer;
let cloudSyncTimer;
let cloudSync;
let backupInProgress = false;

function loadOrCreateJwtSecret(userDataPath) {
  const secretPath = path.join(userDataPath, 'jwt-secret');
  try {
    return fs.readFileSync(secretPath, 'utf8');
  } catch (error) {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretPath, secret, { mode: 0o600, flag: 'wx' });
    return secret;
  }
}

async function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const appOrigin = new URL(url).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(appOrigin)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== appOrigin) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(url);
}

function readBackupSettings() {
  const settingsPath = path.join(app.getPath('userData'), 'backup-settings.json');
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    return {};
  }
}

function writeBackupSettings(settings) {
  const settingsPath = path.join(app.getPath('userData'), 'backup-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

function ensureTrustedAdminPage(event, token) {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl || !process.env.APP_BASE_URL) throw new Error('Backup actions are only available in the desktop app.');
  const frame = new URL(frameUrl);
  const appOrigin = new URL(process.env.APP_BASE_URL).origin;
  if (frame.origin !== appOrigin || frame.pathname !== '/admin-dashboard.html') {
    throw new Error('Backup actions are only available from the administrator dashboard.');
  }
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (user.role !== 'admin') throw new Error('Administrator access is required for database backups.');
  } catch (error) {
    throw new Error('Administrator access is required for database backups.');
  }
}

function registerBackupHandlers(userDataPath, cloudSyncService) {
  const { createBackup, createDailyBackups, installBackup, validateBackupFile } = require('./backup');
  const defaultBackupFolder = path.join(userDataPath, 'backups');

  ipcMain.handle('school-backup:export', async (event, token) => {
    ensureTrustedAdminPage(event, token);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export school database backup',
      defaultPath: path.join(app.getPath('documents'), `school-backup-${new Date().toISOString().slice(0, 10)}.sqlite`),
      filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const database = require('../backend/config/db');
    await createBackup(database.database, filePath);
    return { canceled: false, filePath };
  });

  ipcMain.handle('school-backup:choose-folder', async (event, token) => {
    ensureTrustedAdminPage(event, token);
    const settings = readBackupSettings();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose daily backup folder',
      defaultPath: settings.backupFolder || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    settings.backupFolder = filePaths[0];
    writeBackupSettings(settings);
    await runDailyBackup(userDataPath);
    return { canceled: false, folder: settings.backupFolder };
  });

  ipcMain.handle('school-backup:status', (event, token) => {
    ensureTrustedAdminPage(event, token);
    const settings = readBackupSettings();
    const filename = `school-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
    const todayBackup = path.join(defaultBackupFolder, filename);
    const externalFolder = settings.backupFolder && path.resolve(settings.backupFolder) !== path.resolve(defaultBackupFolder)
      ? settings.backupFolder
      : null;
    return {
      backupFolder: externalFolder,
      localBackupAvailable: fs.existsSync(todayBackup),
      lastBackup: fs.existsSync(todayBackup) ? fs.statSync(todayBackup).mtime.toISOString() : null,
      externalBackupAvailable: Boolean(externalFolder && fs.existsSync(path.join(externalFolder, filename))),
    };
  });

  ipcMain.handle('school-backup:restore', async (event, token) => {
    ensureTrustedAdminPage(event, token);
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select school database backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db', 'sqlite3'] }],
    });
    if (canceled || !filePaths[0]) return { canceled: true };

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Replace school database?',
      message: 'Restoring replaces all current school data with the selected backup.',
      detail: 'The current database will be saved beside it before the app restarts.',
      buttons: ['Cancel', 'Restore and restart'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };

    const database = require('../backend/config/db');
    const databasePath = database.databasePath;
    validateBackupFile(filePaths[0]);
    if (path.resolve(filePaths[0]) === path.resolve(databasePath)) {
      throw new Error('Choose a backup file other than the active database.');
    }
    await new Promise((resolve, reject) => {
      if (!server?.listening) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    });
    server = null;
    try {
      await installBackup(database.database, filePaths[0], databasePath);
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Restore could not be completed',
        message: 'The app will restart using the existing database.',
        detail: error.message,
        buttons: ['Restart'],
        noLink: true,
      });
      app.relaunch();
      app.quit();
      return { canceled: false };
    }
    app.relaunch();
    app.quit();
    return { canceled: false };
  });

  ipcMain.handle('school-cloud:status', (event, token) => {
    ensureTrustedAdminPage(event, token);
    return cloudSyncService.getStatus();
  });

  ipcMain.handle('school-cloud:sync', async (event, token) => {
    ensureTrustedAdminPage(event, token);
    return cloudSyncService.syncNow();
  });

  ipcMain.handle('school-cloud:apply', async (event, token) => {
    ensureTrustedAdminPage(event, token);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Use the Neon database?',
      message: 'Replace this computer’s school records with the latest Neon snapshot?',
      detail: 'The current SQLite database is preserved beside it. The app will restart after the download.',
      buttons: ['Cancel', 'Download and restart'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };
    await new Promise((resolve, reject) => {
      if (!server?.listening) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    });
    server = null;
    try {
      await cloudSyncService.applyCloudSnapshot();
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Cloud download failed',
        message: 'The app will restart using the existing local database.',
        detail: error.message,
        buttons: ['Restart'],
        noLink: true,
      });
    }
    app.relaunch();
    app.quit();
    return { canceled: false };
  });

  ipcMain.handle('school-cloud:publish', async (event, token) => {
    ensureTrustedAdminPage(event, token);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Replace the Neon snapshot?',
      message: 'Upload this computer’s school records as the latest Neon database?',
      detail: 'This replaces the current cloud snapshot. Use daily local or USB backups for rollback.',
      buttons: ['Cancel', 'Upload this computer'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };
    return cloudSyncService.publishLocalSnapshot();
  });
}

async function runDailyBackup(userDataPath) {
  if (backupInProgress) return;
  backupInProgress = true;
  try {
    const database = require('../backend/config/db');
    const { createDailyBackups } = require('./backup');
    const settings = readBackupSettings();
    await createDailyBackups(database.database, userDataPath, settings.backupFolder);
  } catch (error) {
    console.error('Daily school database backup failed:', error);
  } finally {
    backupInProgress = false;
  }
}

function startDailyBackupScheduler(userDataPath, cloudSyncService) {
  registerBackupHandlers(userDataPath, cloudSyncService);
  runDailyBackup(userDataPath);
  backupTimer = setInterval(() => runDailyBackup(userDataPath), 60 * 60 * 1000);
  cloudSyncTimer = setInterval(() => cloudSyncService.syncNow(), 15 * 60 * 1000);
}

async function startDesktopApp() {
  const userDataPath = app.getPath('userData');
  fs.mkdirSync(userDataPath, { recursive: true });
  const settingsPath = path.join(userDataPath, 'settings.env');
  require('dotenv').config({ path: settingsPath });
  if (fs.existsSync(settingsPath)) fs.chmodSync(settingsPath, 0o600);
  process.env.SCHOOL_DB_PATH = path.join(userDataPath, 'school.sqlite');
  process.env.JWT_SECRET = loadOrCreateJwtSecret(userDataPath);
  process.env.NODE_ENV = 'development';
  process.env.ELECTRON_APP = 'true';

  const database = require('../backend/config/db');
  const { createCloudSync } = require('./cloud-sync');
  cloudSync = createCloudSync({
    database,
    databasePath: database.databasePath,
    userDataPath,
    connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  });
  const cloudResult = await cloudSync.syncNow({ allowPull: true });
  if (cloudResult.restartRequired) {
    await database.end();
    await cloudSync.close();
    app.relaunch();
    app.quit();
    return;
  }

  const { startServer } = require('../backend/server');
  server = await startServer(0, '0.0.0.0');
  const port = server.address().port;
  process.env.PORT = String(port);
  process.env.APP_BASE_URL = `http://127.0.0.1:${port}`;
  const { ensureDefaultAdmin } = require('../backend/database/default-admin');
  await ensureDefaultAdmin(database);
  const adminCount = await database.query('SELECT COUNT(*) AS count FROM admins');
  if (Number(adminCount.rows[0].count) > 0 && cloudSync.getStatus().state === 'waiting-for-data') {
    await cloudSync.syncNow();
  }
  startDailyBackupScheduler(userDataPath, cloudSync);
  const adminUsers = await database.query('SELECT id, email FROM admins');
  const legacyCredentialsPath = path.join(userDataPath, 'initial-admin-credentials.txt');
  process.env.ELECTRON_LEGACY_ADMIN_CREDENTIALS_PATH = legacyCredentialsPath;
  const legacyAdminSetup = adminUsers.rows.length === 1
    && adminUsers.rows[0].email === 'admin@localhost'
    && fs.existsSync(legacyCredentialsPath);
  process.env.ELECTRON_LEGACY_ADMIN_SETUP = legacyAdminSetup ? 'true' : 'false';
  const needsAdminSetup = adminUsers.rows.length === 0 || legacyAdminSetup;
  await createWindow(`${process.env.APP_BASE_URL}/${needsAdminSetup ? 'admin-setup.html' : 'login.html'}`);
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.whenReady().then(startDesktopApp).catch(async (error) => {
    console.error('Desktop startup failed:', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'School Management System',
      message: 'The desktop app could not start.',
      detail: error.message,
    });
    app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null && server) {
      createWindow(process.env.APP_BASE_URL);
    }
  });

  app.on('before-quit', () => {
    if (backupTimer) clearInterval(backupTimer);
    if (cloudSyncTimer) clearInterval(cloudSyncTimer);
    if (server?.listening) server.close();
    const database = require('../backend/config/db');
    database.end();
    cloudSync?.close();
  });
}