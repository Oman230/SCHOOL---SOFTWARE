const { hashPassword } = require('../security/passwords');

const DEFAULT_ADMIN = Object.freeze({
  fullName: 'Head Administrator',
  email: 'admin@school.com',
  password: 'password123',
});

async function ensureDefaultAdmin(database) {
  const existingAdmins = await database.query('SELECT id FROM admins LIMIT 1');
  if (existingAdmins.rows.length > 0) return false;

  const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
  await database.query(
    `INSERT INTO admins (full_name, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [DEFAULT_ADMIN.fullName, DEFAULT_ADMIN.email, passwordHash]
  );
  return true;
}

module.exports = { DEFAULT_ADMIN, ensureDefaultAdmin };