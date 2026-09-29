const pool = require('../config/db');

async function setupDatabase() {
  await pool.schemaReady();
  console.log(`SQLite database ready at ${pool.databasePath}`);
}

setupDatabase()
  .catch((error) => {
    console.error('Database setup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
