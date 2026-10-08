async function generateStudentId(pool, year = new Date().getFullYear()) {
  const prefix = `SIS-${year}-`;

  await pool.query(
    `CREATE TABLE IF NOT EXISTS student_id_sequences (
       year INTEGER PRIMARY KEY,
       last_number INTEGER NOT NULL
     )`
  );

  const existingIds = await pool.query(
    'SELECT student_id_number FROM students WHERE student_id_number LIKE $1',
    [`${prefix}%`]
  );
  const highestExistingNumber = existingIds.rows.reduce((highest, row) => {
    const match = String(row.student_id_number).match(new RegExp(`^SIS-${year}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  const sequence = await pool.query(
    `INSERT INTO student_id_sequences (year, last_number)
     VALUES ($1, $2)
     ON CONFLICT (year)
     DO UPDATE SET last_number = CASE
       WHEN student_id_sequences.last_number < $2 THEN $2
       ELSE student_id_sequences.last_number + 1
     END
     RETURNING last_number`,
    [year, highestExistingNumber + 1]
  );

  return `${prefix}${String(sequence.rows[0].last_number).padStart(3, '0')}`;
}

module.exports = { generateStudentId };
