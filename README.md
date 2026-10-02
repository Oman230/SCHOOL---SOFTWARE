# SCHOOL-MANAGEMENT

## Project Structure

- `frontend/` contains the public pages, styles, scripts, and images.
- `backend/` contains the Express server, API routes, controllers, database files, middleware, security helpers, and tests.
- Root files contain project configuration, environment settings, and documentation.

Run `npm start` to start the server, `npm test` to run backend tests, and `npm run setup-db` to apply the database schema.

## Desktop App

The Electron app runs the existing interface and API locally. When `SHARED_DATABASE_URL`, `DATABASE_URL`, or `NEON_DATABASE_URL` is configured, Electron connects directly to that PostgreSQL database, so changes appear in the web app and Electron immediately. Without a shared URL, it uses a local SQLite database and optional snapshot sync. Install dependencies with `npm install`, then launch the desktop app with `npm run desktop`. On a fresh install, sign in with the default administrator credentials listed below.

The database and signing key are stored in Electron's per-user application data folder. A fresh desktop install creates the default administrator account `admin@school.com` with password `password123`. Existing administrator accounts and passwords are preserved. The app creates the database automatically; `npm run seed` is only for development sample accounts. SQLite data is new and is not automatically imported from an existing PostgreSQL database.

The administrator dashboard includes **Export backup** and **Import backup** in both database modes. SQLite exports use `.sqlite` files and support daily backups plus optional Neon snapshot sync. Shared PostgreSQL exports use portable `.schoolbackup` files; importing replaces all school records in that shared database after confirmation. Store exported backups securely because they contain student and family data.

Backups placed in a Google Drive/OneDrive sync folder are file backups managed by that provider. Neon sync is a separate snapshot service and is configured below.

The standalone backend uses `DATABASE_URL` or `NEON_DATABASE_URL` for PostgreSQL. To make an installed Electron app use the exact web/local-host records and administrator account, put the same database URL in `settings.env` in Electron's per-user application data folder (`%APPDATA%/SunriseSchoolManagement/settings.env` on Windows or `~/Library/Application Support/SunriseSchoolManagement/settings.env` on macOS), then restart the app. The URL is a private credential and is deliberately not embedded in installers. Without it, the installer creates its own local SQLite database and its changes cannot appear on the web server. To retain offline-first SQLite and snapshot sync instead, set `DB_DRIVER=sqlite` in `settings.env`; changes then sync as database snapshots, with conflict prompts if multiple offline copies change. Keep database connection strings private and use one school database per school.

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