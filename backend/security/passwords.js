const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;
const MAX_PASSWORD_LENGTH = 72;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    return 'Password must be between 8 and 72 characters.';
  }
  return null;
}

async function hashPassword(password) {
  const validationError = validatePassword(password);
  if (validationError) {
    const error = new Error(validationError);
    error.code = 'INVALID_PASSWORD';
    throw error;
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = { BCRYPT_COST, validatePassword, hashPassword, verifyPassword };
