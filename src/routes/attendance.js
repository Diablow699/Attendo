import { Router } from "express";
import { pool } from "../db.js";
import { requireDevice } from "../middleware/deviceAuth.js";

const router = Router();
router.use(requireDevice);

const GRACE_PERIOD_MINUTES = 10;

router.post("/scan", async (req, res) => {
  const { fingerprintId, scannedAt } = req.body;
  if (fingerprintId === undefined) return res.status(400).json({ error: "Missing fingerprintId" });

  const now = scannedAt ? new Date(scannedAt) : new Date();
  if (isNaN(now.getTime())) return res.status(400).json({ error: "Invalid scannedAt timestamp" });

  const client = await pool.connect();
  try {
    const dayOfWeek = now.getDay();
    const timeStr = now.toTimeString().slice(0, 8);

    const studentRes = await client.query("SELECT id, full_name, student_id FROM students WHERE fingerprint_id=$1", [fingerprintId]);
    if (!studentRes.rows.length) return res.status(404).json({ error: "No student matches that fingerprint." });
    const student = studentRes.rows[0];

    const scheduleRes = await client.query(
      `SELECT sc.start_time, sc.end_time, sub.id AS subject_id, sub.name AS subject_name
       FROM schedules sc JOIN subjects sub ON sub.id = sc.subject_id
       WHERE sc.day_of_week=$1 AND sc.start_time <= $2 AND sc.end_time >= $2 LIMIT 1`,
      [dayOfWeek, timeStr]
    );
    if (!scheduleRes.rows.length) return res.status(409).json({ error: "No class is currently in session.", student });
    const schedule = scheduleRes.rows[0];

    const enrolledRes = await client.query("SELECT 1 FROM subject_students WHERE subject_id=$1 AND student_id=$2", [schedule.subject_id, student.id]);
    if (!enrolledRes.rows.length) return res.status(409).json({ error: `${student.full_name} is not enrolled in ${schedule.subject_name}.`, student });

    const existingRes = await client.query(
      `SELECT id FROM attendance_logs WHERE student_id=$1 AND subject_id=$2 AND scanned_at::date = $3::date`,
      [student.id, schedule.subject_id, now]
    );
    if (existingRes.rows.length) return res.status(409).json({ error: `${student.full_name} already has an attendance record for ${schedule.subject_name} today.`, student });

    const [startH, startM] = schedule.start_time.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const status = nowMinutes > startMinutes + GRACE_PERIOD_MINUTES ? "late" : "present";

    const insertRes = await client.query(
      `INSERT INTO attendance_logs (student_id, subject_id, device_id, scanned_at, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING scanned_at, status`,
      [student.id, schedule.subject_id, req.device.id, now, status]
    );

    res.status(201).json({
      student: { id: student.id, fullName: student.full_name, studentId: student.student_id },
      subject: { id: schedule.subject_id, name: schedule.subject_name },
      status: insertRes.rows[0].status,
      scannedAt: insertRes.rows[0].scanned_at,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

export default router;
