# SCHOOL-MANAGEMENT

## Project Structure

- `frontend/` contains the public pages, styles, scripts, and images.
- `backend/` contains the Express server, API routes, controllers, database files, middleware, security helpers, and tests.
- Root files contain project configuration, environment settings, and documentation.

Run `npm start` to start the server, `npm test` to run backend tests, and `npm run setup-db` to apply the database schema.

## Desktop App

The Electron app runs the existing interface and API locally and stores data in SQLite. Install dependencies with `npm install`, then launch the desktop app with `npm run desktop`. On a fresh install, sign in with the default administrator credentials listed below.

The database and signing key are stored in Electron's per-user application data folder. A fresh desktop install creates the default administrator account `admin@school.com` with password `password123`. Existing administrator accounts are preserved. The app creates the database automatically; `npm run seed` is only for development sample accounts. SQLite data is new and is not automatically imported from an existing PostgreSQL database.

The administrator dashboard includes **Export backup**, **Restore backup**, and **Choose daily backup folder**. The app creates a daily SQLite backup on startup and checks hourly, retaining the latest 30 daily copies in its application data folder. Choose a USB drive or a locally mounted Google Drive/OneDrive sync folder to keep an additional daily copy off the computer. Keep the drive connected while the app is running; exports can also be saved to any location. Restoring validates the selected SQLite database, saves the current database beside it, then restarts the app. Store backup files securely because they contain student and family data.

Backups placed in a Google Drive/OneDrive sync folder are file backups managed by that provider. Neon sync is a separate snapshot service and is configured below.

The standalone backend tests the Neon connection when started with `npm start`, using `NEON_DATABASE_URL` or `DATABASE_URL`. A connection-test failure is logged but does not prevent the local SQLite server from starting. To enable Electron snapshot sync, put a rotated Neon connection string in the per-user `settings.env` file as `NEON_DATABASE_URL` or `DATABASE_URL`, then restart the app. The app stores the latest SQLite snapshot in that Neon database, checks for changes every 15 minutes, and pulls the cloud snapshot on a new installation. SQLite remains the working database when offline. If two computers both make offline changes, sync stops and the admin must choose which snapshot to download or upload; it will not silently merge or overwrite those changes. Neon stores one current snapshot per school; keep daily local or USB backups for rollback. Use one Neon database per school. Keep the connection string private and rotate it if it has been shared.

Optional Paystack and SMTP settings can be placed in `settings.env` in that same application data folder. See `.env.example` for the supported variable names, then restart the app. Leave these values unset to use the core app offline.

Build Intel Mac installers with `npm run dist:mac`, Apple Silicon installers with `npm run dist:mac:arm64`, and Windows installers with `npm run dist:win`. The produced installers are written to `dist/`.

Distributing signed installers requires the appropriate Apple signing/notarization credentials or Windows code-signing certificate.

Core school records work without internet access. Paystack payments, SMTP email, and WhatsApp contact links require an internet connection; payments and email cannot be completed offline.

## Parent Email Notices

Bulk parent notices use SMTP. Add these values to the server `.env` file before sending email:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=school@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=school@example.com
```

Admins email every non-empty `parent_email` in the student records. Teachers email the parent addresses belonging to students in their assigned classroom. Messages are sent as BCC recipients so parent addresses are not exposed to one another.

## Security Configuration

The desktop app generates and stores its own JWT signing key. For production server deployments, set a unique `JWT_SECRET` of at least 32 random bytes, `NODE_ENV=production`, `HTTPS_KEY_PATH`, and `HTTPS_CERT_PATH`; the built-in HTTPS server requires TLS 1.2 or newer and AES-256-GCM cipher suites. The server applies security headers and rejects cross-origin state-changing API requests.