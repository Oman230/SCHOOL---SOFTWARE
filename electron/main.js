const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, shell } = require('electron');

app.setPath('userData', path.join(app.getPath('appData'), 'SunriseSchoolManagement'));

let server;
let mainWindow;

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

async function createInitialAdmin() {
  const database = require('../backend/config/db');
  const credentialsPath = path.join(app.getPath('userData'), 'initial-admin-credentials.txt');
  const result = await database.query('SELECT COUNT(*) AS count FROM admins');
  if (Number(result.rows[0].count) > 0) {
    if (fs.existsSync(credentialsPath)) await showInitialAdminCredentials(credentialsPath);
    return;
  }

  const email = 'admin@localhost';
  const password = crypto.randomBytes(18).toString('base64url');
  const { hashPassword } = require('../backend/security/passwords');
  const passwordHash = await hashPassword(password);
  await database.query(
    'INSERT INTO admins (full_name, email, password_hash) VALUES ($1, $2, $3)',
    ['School Administrator', email, passwordHash]
  );

  fs.writeFileSync(credentialsPath, `Email: ${email}\nPassword: ${password}\n`, { mode: 0o600 });
  await showInitialAdminCredentials(credentialsPath);
}

async function showInitialAdminCredentials(credentialsPath) {
  await dialog.showMessageBox({
    type: 'info',
    title: 'First-time setup',
    message: 'Your local administrator account is ready.',
    detail: `Save these credentials, then delete the credentials file. This dialog will reappear until you remove it.\n\n${fs.readFileSync(credentialsPath, 'utf8')}\nFile: ${credentialsPath}`,
    buttons: ['Continue'],
    noLink: true,
  });
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

async function startDesktopApp() {
  const userDataPath = app.getPath('userData');
  fs.mkdirSync(userDataPath, { recursive: true });
  require('dotenv').config({ path: path.join(userDataPath, 'settings.env') });
  process.env.SCHOOL_DB_PATH = path.join(userDataPath, 'school.sqlite');
  process.env.JWT_SECRET = loadOrCreateJwtSecret(userDataPath);
  process.env.NODE_ENV = 'development';

  const { startServer } = require('../backend/server');
  await createInitialAdmin();
  server = await startServer(0, '127.0.0.1');

  const port = server.address().port;
  process.env.PORT = String(port);
  process.env.APP_BASE_URL = `http://127.0.0.1:${port}`;
  await createWindow(process.env.APP_BASE_URL);
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
    if (server?.listening) server.close();
    const database = require('../backend/config/db');
    database.end();
  });
}