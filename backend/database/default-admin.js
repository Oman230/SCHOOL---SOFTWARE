const { hashPassword, verifyPassword } = require('../security/passwords');

const DEFAULT_ADMIN = Object.freeze({
  fullName: 'Head Administrator',
  email: 'admin@school.com',
  password: 'password123',
});

async function ensureDefaultAdmin(database) {
  const existingAdmins = await database.query('SELECT id, email, full_name, password_hash FROM admins ORDER BY id');
  if (existingAdmins.rows.length === 0) {
    const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
    await database.query(
      `INSERT INTO admins (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [DEFAULT_ADMIN.fullName, DEFAULT_ADMIN.email, passwordHash]
    );
    return true;
  }

  if (existingAdmins.rows.length !== 1) return false;

  const [admin] = existingAdmins.rows;
  const isLegacyDefaultAdmin = admin.email === 'admin@localhost';
  if (!isLegacyDefaultAdmin && admin.email !== DEFAULT_ADMIN.email) return false;

  const defaultPasswordMatches = admin.password_hash
    ? await verifyPassword(DEFAULT_ADMIN.password, admin.password_hash)
    : false;

  if (defaultPasswordMatches) return false;

  const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
  await database.query(
    `UPDATE admins
     SET full_name = $1,
         email = $2,
         password_hash = $3
     WHERE id = $4`,
    [DEFAULT_ADMIN.fullName, DEFAULT_ADMIN.email, passwordHash, admin.id]
  );
  return true;
}

module.exports = { DEFAULT_ADMIN, ensureDefaultAdmin };