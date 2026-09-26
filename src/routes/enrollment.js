import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { queueEnrollment, getPendingCommand, getResult } from "../deviceStore.js";

const router = Router();
router.use(requireAuth);

// POST /api/subjects/:id/enroll-start -- the manual "Add Student" flow.
// Creates a brand-new student once the scan succeeds.
router.post("/subjects/:id/enroll-start", async (req, res) => {
  const { id } = req.params;
  const { fullName } = req.body;
  if (!fullName) return res.status(400).json({ error: "Missing full name" });

  if (getPendingCommand()) {
    return res.status(409).json({ error: "Scanner is already busy with another enrollment." });
  }

  try {
    const slotRes = await pool.query("SELECT COALESCE(MAX(fingerprint_id), 0) + 1 AS next FROM students");
    const slot = slotRes.rows[0].next;
    const requestId = `${Date.now()}-${slot}`;
    queueEnrollment({ requestId, slot, subjectId: id, fullName: fullName.trim() });
    res.status(202).json({ requestId, slot });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/students/:studentId/register-start -- the "Register" button flow.
// The student already exists (imported from Excel, no fingerprint yet) --
// this just assigns a slot and, once scanned, UPDATEs that existing row
// instead of creating a new one.
router.post("/students/:studentId/register-start", async (req, res) => {
  const { studentId } = req.params;

  if (getPendingCommand()) {
    return res.status(409).json({ error: "Scanner is already busy with another enrollment." });
  }

  try {
    const studentRes = await pool.query(
      "SELECT id, full_name, fingerprint_id FROM students WHERE id=$1",
      [studentId]
    );
    if (!studentRes.rows.length) return res.status(404).json({ error: "Student not found" });
    if (studentRes.rows[0].fingerprint_id !== null) {
      return res.status(409).json({ error: "This student is already registered." });
    }

    const slotRes = await pool.query("SELECT COALESCE(MAX(fingerprint_id), 0) + 1 AS next FROM students");
    const slot = slotRes.rows[0].next;
    const requestId = `${Date.now()}-${slot}`;
    queueEnrollment({
      requestId,
      slot,
      subjectId: null,
      fullName: studentRes.rows[0].full_name,
      existingStudentDbId: studentRes.rows[0].id,
    });
    res.status(202).json({ requestId, slot });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/enroll-status/:requestId", (req, res) => {
  const result = getResult(req.params.requestId);
  if (!result) return res.status(404).json({ error: "Unknown request" });
  res.json(result);
});

export default router;
