-- Attendo: IoT Fingerprint Attendance System
-- PostgreSQL schema

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'teacher',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id SERIAL PRIMARY KEY,
    device_key VARCHAR(100) UNIQUE NOT NULL,
    label VARCHAR(100) NOT NULL DEFAULT 'Main scanner',
    status VARCHAR(20) NOT NULL DEFAULT 'offline',
    last_seen TIMESTAMPTZ
);

CREATE TABLE subjects (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    section VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_until DATE,
    CHECK (end_time > start_time)
);

-- fingerprint_id is now NULLABLE: a student can exist (e.g. imported from
-- Excel) before they've had their finger scanned. NULL = not yet registered.
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    student_id VARCHAR(30) UNIQUE NOT NULL,
    fingerprint_id INTEGER UNIQUE,
    device_id INTEGER NOT NULL REFERENCES devices(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subject_students (
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    PRIMARY KEY (subject_id, student_id)
);

CREATE TABLE attendance_logs (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL REFERENCES devices(id),
    scanned_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'present',
    UNIQUE (student_id, subject_id, scanned_at)
);

CREATE INDEX idx_schedules_day_time ON schedules (day_of_week, start_time, end_time);
CREATE INDEX idx_attendance_student_subject_date ON attendance_logs (student_id, subject_id, scanned_at);
CREATE INDEX idx_students_fingerprint ON students (fingerprint_id);

INSERT INTO users (full_name, email, password_hash, role)
VALUES ('Maria Santos', 'teacher@school.edu', 'REPLACE_WITH_BCRYPT_HASH', 'teacher');

INSERT INTO devices (device_key, label, status)
VALUES ('ESP32-MAIN-01', 'Main scanner', 'offline');

INSERT INTO subjects (teacher_id, name, section) VALUES
  (1, 'Math 101', 'BSIT-3A'),
  (1, 'Science 201', 'BSIT-3B');

INSERT INTO schedules (subject_id, day_of_week, start_time, end_time) VALUES
  (1, 1, '08:00', '09:00'),
  (1, 3, '08:00', '09:00'),
  (1, 5, '08:00', '09:00'),
  (2, 2, '09:00', '10:30'),
  (2, 4, '09:00', '10:30');

INSERT INTO students (full_name, student_id, fingerprint_id, device_id) VALUES
  ('Juan Dela Cruz', 'STU-1001', 1, 1),
  ('Ana Reyes', 'STU-1002', 2, 1),
  ('Marco Villanueva', 'STU-1003', 3, 1);

INSERT INTO subject_students (subject_id, student_id) VALUES
  (1, 1), (1, 2), (2, 3);
