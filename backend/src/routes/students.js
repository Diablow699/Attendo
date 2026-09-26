import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

router.get("/subjects/:id/detail", async (req, res) => {
  const { id } = req.params;
  try {
    const subj = await pool.query("SELECT * FROM subjects WHERE id=$1 AND teacher_id=$2", [id, req.user.id]);
    if (!subj.rows.length) return res.status(404).json({ error: "Subject not found" });

    const sched = await pool.query(
      "SELECT day_of_week, start_time, end_time FROM schedules WHERE subject_id=$1 ORDER BY day_of_week",
      [id]
    );

    // How many session dates have occurred so far, based on the schedule's
    // days of week and how long it's been running (from its earliest
    // effective_from date up to today, inclusive).
    const totalRes = await pool.query(
      `SELECT COUNT(*) AS total FROM generate_series(
         (SELECT MIN(effective_from) FROM schedules WHERE subject_id=$1),
         CURRENT_DATE,
         '1 day'
       ) AS d
       WHERE EXTRACT(DOW FROM d) IN (SELECT day_of_week FROM schedules WHERE subject_id=$1)`,
      [id]
    );
    const totalSessions = parseInt(totalRes.rows[0].total, 10);

    const students = await pool.query(
      `SELECT st.id, st.full_name, st.student_id, st.fingerprint_id,
              al_today.status AS today_status, al_today.scanned_at AS today_scanned_at,
              COALESCE(att.attended, 0) AS sessions_attended
       FROM students st
       JOIN subject_students ss ON ss.student_id = st.id
       LEFT JOIN attendance_logs al_today
         ON al_today.student_id = st.id AND al_today.subject_id = $1 AND al_today.scanned_at::date = CURRENT_DATE
       LEFT JOIN (
         SELECT student_id, COUNT(DISTINCT scanned_at::date) AS attended
         FROM attendance_logs
         WHERE subject_id = $1 AND status IN ('present','late')
         GROUP BY student_id
       ) att ON att.student_id = st.id
       WHERE ss.subject_id=$1 ORDER BY st.full_name`,
      [id]
    );

    res.json({
      id: subj.rows[0].id,
      name: subj.rows[0].name,
      section: subj.rows[0].section,
      days: sched.rows.map((r) => DAY_NAMES[r.day_of_week]),
      start: sched.rows[0]?.start_time?.slice(0, 5),
      end: sched.rows[0]?.end_time?.slice(0, 5),
      totalSessions,
      students: students.rows.map((s) => ({
        id: s.id,
        fullName: s.full_name,
        studentId: s.student_id,
        fingerprintId: s.fingerprint_id,
        todayStatus: s.today_status || "none",
        todayScannedAt: s.today_scanned_at,
        sessionsAttended: parseInt(s.sessions_attended, 10),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Only students who actually have a fingerprint registered can be scanned,
// so the dashboard's scan simulator dropdown excludes unregistered ones.
router.get("/students", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT st.id, st.full_name, st.student_id, st.fingerprint_id
       FROM students st
       JOIN subject_students ss ON ss.student_id = st.id
       JOIN subjects sub ON sub.id = ss.subject_id
       WHERE sub.teacher_id = $1 AND st.fingerprint_id IS NOT NULL
       ORDER BY st.full_name`,
      [req.user.id]
    );
    res.json(result.rows.map((s) => ({
      id: s.id, fullName: s.full_name, studentId: s.student_id, fingerprintId: s.fingerprint_id,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/subjects/:subjectId/students/:studentId", async (req, res) => {
  try {
    const subj = await pool.query("SELECT id FROM subjects WHERE id=$1 AND teacher_id=$2", [req.params.subjectId, req.user.id]);
    if (!subj.rows.length) return res.status(404).json({ error: "Subject not found" });
    const result = await pool.query(
      "DELETE FROM subject_students WHERE subject_id=$1 AND student_id=$2 RETURNING student_id",
      [req.params.subjectId, req.params.studentId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Student not found in this subject" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/subjects/:id/students/bulk-import
// Body: { students: [{ fullName, studentId }, ...] } -- parsed from the
// teacher's uploaded Excel file on the frontend. Creates each student
// WITHOUT a fingerprint (fingerprint_id stays NULL) and links them to this
// subject immediately. They show up on the roster right away with a
// "Register" button in place of a fingerprint slot.
router.post("/subjects/:id/students/bulk-import", async (req, res) => {
  const { id } = req.params;
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: "No students provided" });
  }

  const subj = await pool.query("SELECT id FROM subjects WHERE id=$1 AND teacher_id=$2", [id, req.user.id]);
  if (!subj.rows.length) return res.status(404).json({ error: "Subject not found" });

  const created = [];
  const failed = [];

  for (const row of students) {
    const fullName = (row.fullName || "").trim();
    const studentId = (row.studentId || "").trim();
    if (!fullName || !studentId) {
      failed.push({ row, reason: "Missing name or student ID" });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const studentRes = await client.query(
        `INSERT INTO students (full_name, student_id, fingerprint_id, device_id)
         VALUES ($1, $2, NULL, 1)
         RETURNING id, full_name, student_id`,
        [fullName, studentId]
      );
      const student = studentRes.rows[0];
      await client.query("INSERT INTO subject_students (subject_id, student_id) VALUES ($1, $2)", [id, student.id]);
      await client.query("COMMIT");
      created.push({ id: student.id, fullName: student.full_name, studentId: student.student_id });
    } catch (e) {
      await client.query("ROLLBACK");
      failed.push({ row, reason: e.code === "23505" ? `Student ID "${studentId}" already exists` : "Server error" });
    } finally {
      client.release();
    }
  }

  res.status(201).json({ created, failed });
});

export default router;
