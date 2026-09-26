import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requestScheduleRefresh } from "../deviceStore.js";

const router = Router();
router.use(requireAuth);

const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

router.get("/", async (req, res) => {
  try {
    const subjects = await pool.query(
      `SELECT id, name, section FROM subjects WHERE teacher_id=$1 AND is_active=true ORDER BY created_at`,
      [req.user.id]
    );

    const result = [];
    for (const subj of subjects.rows) {
      const sched = await pool.query(
        `SELECT day_of_week, start_time, end_time FROM schedules WHERE subject_id=$1 ORDER BY day_of_week`,
        [subj.id]
      );
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM subject_students WHERE subject_id=$1`,
        [subj.id]
      );

      result.push({
        id: subj.id,
        name: subj.name,
        section: subj.section,
        days: sched.rows.map((r) => DAY_NAMES[r.day_of_week]),
        start: sched.rows[0]?.start_time?.slice(0, 5) || null,
        end: sched.rows[0]?.end_time?.slice(0, 5) || null,
        studentCount: parseInt(countRes.rows[0].count, 10),
      });
    }

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", async (req, res) => {
  const { name, section, days, start, end } = req.body;
  if (!name || !section || !days?.length || !start || !end) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const day of days) {
      const dow = DAY_MAP[day];
      const conflict = await client.query(
        `SELECT sub.name FROM schedules sc
         JOIN subjects sub ON sub.id = sc.subject_id
         WHERE sc.day_of_week=$1 AND sc.start_time < $3 AND sc.end_time > $2 AND sub.teacher_id=$4`,
        [dow, start, end, req.user.id]
      );
      if (conflict.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: `Time conflict with ${conflict.rows[0].name} on ${day}` });
      }
    }

    const subjRes = await client.query(
      "INSERT INTO subjects (teacher_id, name, section) VALUES ($1, $2, $3) RETURNING id",
      [req.user.id, name, section]
    );
    const subjectId = subjRes.rows[0].id;

    for (const day of days) {
      await client.query(
        "INSERT INTO schedules (subject_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)",
        [subjectId, DAY_MAP[day], start, end]
      );
    }

    await client.query("COMMIT");
    requestScheduleRefresh();
    res.status(201).json({ id: subjectId, name, section, days, start, end, studentCount: 0 });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM subjects WHERE id=$1 AND teacher_id=$2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Subject not found" });
    requestScheduleRefresh();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;