import { Router } from "express";
import { pool } from "../db.js";
import { requireDevice } from "../middleware/deviceAuth.js";
import { getPendingCommand, clearPendingCommand, setResult, consumeScheduleRefreshRequest } from "../deviceStore.js";

const router = Router();
router.use(requireDevice);

router.get("/command", (req, res) => {
  // A schedule refresh takes priority -- it's quick for the device to act on
  // and shouldn't wait behind a pending enrollment.
  if (consumeScheduleRefreshRequest()) {
    return res.json({ action: "refresh_schedule" });
  }

  const pending = getPendingCommand();
  if (!pending) return res.json({ action: "idle" });
  res.json({ action: "enroll", requestId: pending.requestId, slot: pending.slot });
});

router.get("/schedule", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sc.day_of_week, sc.start_time, sc.end_time, sub.id AS subject_id, sub.name AS subject_name
       FROM schedules sc JOIN subjects sub ON sub.id = sc.subject_id
       WHERE sub.is_active = true ORDER BY sc.day_of_week, sc.start_time`
    );
    res.json(result.rows.map((r) => ({
      subjectId: r.subject_id, subjectName: r.subject_name, dayOfWeek: r.day_of_week,
      startTime: r.start_time.slice(0, 5), endTime: r.end_time.slice(0, 5),
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/device/enroll-result
// Branches on whether this enrollment was for a brand-new student (manual
// "Add Student") or linking a fingerprint to an already-imported student
// (the "Register" button flow).
router.post("/enroll-result", async (req, res) => {
  const { requestId, slot, success } = req.body;
  if (!requestId || slot === undefined) {
    return res.status(400).json({ error: "Missing requestId or slot" });
  }

  const pending = getPendingCommand();
  if (!pending || pending.requestId !== requestId) {
    return res.json({ ok: true });
  }
  clearPendingCommand();

  if (!success) {
    setResult(requestId, { status: "failed" });
    return res.json({ ok: true });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let student;

    if (pending.existingStudentDbId) {
      // Fill in the fingerprint slot on the already-existing (imported) row.
      const updateRes = await client.query(
        `UPDATE students SET fingerprint_id=$1 WHERE id=$2
         RETURNING id, full_name, student_id, fingerprint_id`,
        [slot, pending.existingStudentDbId]
      );
      student = updateRes.rows[0];
    } else {
      // Original flow: create a brand-new student with a generated ID.
      const studentIdStr = `STU-${1000 + slot}`;
      const insertRes = await client.query(
        `INSERT INTO students (full_name, student_id, fingerprint_id, device_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, student_id, fingerprint_id`,
        [pending.fullName, studentIdStr, slot, req.device.id]
      );
      student = insertRes.rows[0];
      await client.query("INSERT INTO subject_students (subject_id, student_id) VALUES ($1, $2)", [pending.subjectId, student.id]);
    }

    await client.query("COMMIT");
    setResult(requestId, {
      status: "success",
      student: {
        id: student.id, fullName: student.full_name,
        studentId: student.student_id, fingerprintId: student.fingerprint_id,
      },
    });
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    setResult(requestId, { status: "failed" });
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

export default router;
