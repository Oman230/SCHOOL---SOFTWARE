require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    console.log('Creating tables on Neon...');
    await pool.query(sql);
    console.log('Tables created on Neon');
  } catch (e) {
    console.error('Failed:', e.message);
  } finally {
    await pool.end();
  }
})();