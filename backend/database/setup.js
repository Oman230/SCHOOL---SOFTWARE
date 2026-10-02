const pool = require('../config/db');

async function setupDatabase() {
  await pool.schemaReady();
  if (pool.driver === 'postgres') {
    console.log('PostgreSQL database schema is available.');
  } else {
    console.log(`SQLite database ready at ${pool.databasePath}`);
  }
}

setupDatabase()
  .catch((error) => {
    console.error('Database setup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
