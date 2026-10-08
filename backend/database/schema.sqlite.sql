PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admission_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_number TEXT UNIQUE NOT NULL,
  student_full_name TEXT NOT NULL,
  date_of_birth TEXT,
  gender TEXT,
  applying_for_level TEXT NOT NULL,
  previous_school TEXT,
  parent_name TEXT NOT NULL,
  parent_email TEXT NOT NULL,
  parent_phone TEXT NOT NULL,
  home_address TEXT,
  medical_notes TEXT,
  declaration_accepted INTEGER NOT NULL DEFAULT 0,
  parent_signature TEXT NOT NULL,
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS classrooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  classroom_id INTEGER REFERENCES classrooms(id),
  photo_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id_number TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  date_of_birth TEXT,
  gender TEXT,
  classroom_id INTEGER REFERENCES classrooms(id),
  photo_url TEXT,
  parent_name TEXT,
  parent_email TEXT,
  parent_phone TEXT,
  total_fees_due NUMERIC DEFAULT 0,
  amount_paid NUMERIC DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_id_sequences (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  due_date TEXT,
  attachments TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_level TEXT NOT NULL,
  term TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES admins(id),
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (school_level, term)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INTEGER REFERENCES teachers(id),
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  class_teacher_remark TEXT,
  headteacher_remark TEXT,
  attendance TEXT,
  promoted_to TEXT,
  classroom_name TEXT,
  promotion_status TEXT,
  attitude_values_competencies TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, academic_year, term)
);

CREATE TABLE IF NOT EXISTS report_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id),
  class_score NUMERIC DEFAULT 0,
  exam_score NUMERIC DEFAULT 0,
  total_score NUMERIC GENERATED ALWAYS AS (class_score + exam_score) STORED,
  grade TEXT,
  subject_remark TEXT,
  position_in_subject INTEGER,
  UNIQUE (report_id, subject_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  paystack_reference TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT 'paystack',
  academic_year TEXT,
  classroom_name TEXT,
  paid_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO classrooms (name, level) VALUES
  ('JHS 1A', 'Junior High School 1'),
  ('JHS 2A', 'Junior High School 2'),
  ('JHS 3A', 'Junior High School 3');

INSERT OR IGNORE INTO subjects (name) VALUES
  ('Mathematics'),
  ('English Language'),
  ('Integrated Science'),
  ('Social Studies'),
  ('Religious and Moral Education'),
  ('Information and Communication Technology'),
  ('Ghanaian Language'),
  ('French');