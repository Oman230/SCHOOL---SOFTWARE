// server.js
// This is the entry point of the whole backend. Running "npm start" runs this file.
// It sets up Express, connects our routes, and serves the frontend HTML/CSS/JS.

const express = require('express');
const cors = require('cors');       // allows the frontend (if served separately) to call this API
const path = require('path');       // built-in Node module for working with file paths
const fs = require('fs');
const http = require('http');
const https = require('https');
const helmet = require('helmet');
const { csrfProtection } = require('./middleware/csrf');
const { isDevelopmentLanOrigin } = require('./security/origins');
require('dotenv').config();         // load variables from .env into process.env

const frontendPath = path.join(__dirname, '..', 'frontend');
const publicPath = path.join(frontendPath, 'public');
const app = express(); // create the Express application
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32)) {
  throw new Error('JWT_SECRET must be at least 32 bytes in production.');
}
app.disable('x-powered-by');
app.use(helmet({
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  contentSecurityPolicy: false,
}));

app.get('/config.js', (req, res) => {
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_your_key_here';
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  const adminWhatsAppNumber = String(process.env.ADMIN_WHATSAPP_NUMBER || '233557801521').replace(/\D/g, '');
  const paystackEnabled = Boolean(process.env.PAYSTACK_PUBLIC_KEY && process.env.PAYSTACK_SECRET_KEY);

  res.type('application/javascript');
  res.send(`
    window.PAYSTACK_PUBLIC_KEY = ${JSON.stringify(publicKey)};
    window.APP_BASE_URL = ${JSON.stringify(baseUrl)};
    window.APP_DATABASE_MODE = ${JSON.stringify(process.env.APP_DATABASE_MODE || 'local')};
    window.ADMIN_WHATSAPP_NUMBER = ${JSON.stringify(adminWhatsAppNumber)};
    window.PAYSTACK_ENABLED = ${JSON.stringify(paystackEnabled)};
  `);
});

// ---------------------- MIDDLEWARE ----------------------
const configuredOrigin = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : undefined;
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (configuredOrigin === origin || (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) || isDevelopmentLanOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin denied.'));
  },
  credentials: false,
}));
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));  // allow large base64 image payloads (student profile photos)
app.use('/api', csrfProtection);

// Serve the dedicated landing page at the root URL before the static middleware catches it.
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'html', 'home.html'));
});

// Keep page URLs at the site root while storing HTML separately from assets.
app.use(express.static(path.join(publicPath, 'html')));

// Serve frontend assets from the public folder.
app.use(express.static(publicPath));
app.use('/assets', express.static(path.join(frontendPath, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ---------------------- API ROUTES ----------------------
// Each of these files defines a group of related endpoints, kept separate for organization.
app.use('/api/auth', require('./routes/authRoutes'));         // login endpoints
app.use('/api/students', require('./routes/studentRoutes'));  // student profile/dashboard data
app.use('/api/teachers', require('./routes/teacherRoutes'));  // teacher profile/class/reports
app.use('/api/reports', require('./routes/reportRoutes'));    // viewing/printing report cards
app.use('/api/payments', require('./routes/paymentRoutes'));  // Paystack fee payments
app.use('/api/announcements', require('./routes/announcementRoutes')); // public school announcements
app.use('/api/admissions', require('./routes/admissionRoutes'));     // public admission applications
app.use('/api/admin', require('./routes/adminRoutes'));       // admin panel: manage students/teachers/classrooms

// ---------------------- FALLBACK ROUTE ----------------------
// If someone visits any unknown page, just send them the home page instead of an error.
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'html', 'index.html'));
});

// ---------------------- START SERVER ----------------------
const DEFAULT_PORT = Number(process.env.PORT) || 5000;

async function startServer(port = DEFAULT_PORT, host) {
  const pool = require('./config/db');
  if (pool.driver === 'postgres') await pool.schemaReady();

  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;
  const useHttps = Boolean(keyPath && certPath);
  if (useHttps && (!fs.existsSync(keyPath) || !fs.existsSync(certPath))) {
    throw new Error('HTTPS_KEY_PATH and HTTPS_CERT_PATH must point to readable certificate files.');
  }

  return new Promise((resolve, reject) => {
    const server = useHttps
      ? https.createServer({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        minVersion: 'TLSv1.2',
        ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384',
        honorCipherOrder: true,
      }, app)
      : http.createServer(app);

    const onListening = () => {
      const address = server.address();
      const protocol = useHttps ? 'https' : 'http';
      console.log(`🚀 School Management System running at ${protocol}://localhost:${address.port}`);
      if (!useHttps && process.env.NODE_ENV === 'production') {
        console.warn('HTTPS is not configured. Set HTTPS_KEY_PATH and HTTPS_CERT_PATH before production use.');
      }
      resolve(server);
    };

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && port > 0) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is busy. Retrying on http://localhost:${nextPort}...`);
        startServer(nextPort, host).then(resolve, reject);
        return;
      }
      reject(error);
    });

    if (host) server.listen(port, host, onListening);
    else server.listen(port, onListening);
  });
}

if (require.main === module) {
  const { testNeonConnection } = require('../electron/cloud-sync');
  const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  const testConfiguredNeon = async () => {
    if (!connectionString) {
      console.info('[Neon] Connection test skipped: set NEON_DATABASE_URL or DATABASE_URL.');
      return;
    }
    try {
      await testNeonConnection(connectionString);
      console.info('[Neon] Connection test passed.');
    } catch (error) {
      console.error(`[Neon] Connection test failed${error.code ? ` (${error.code})` : ''}. SQLite server will still start.`);
    }
  };

  testConfiguredNeon().then(() => startServer()).catch((error) => {
    console.error('❌ Server failed to start:', error);
    process.exit(1);
  });
}

module.exports = { app, startServer };
