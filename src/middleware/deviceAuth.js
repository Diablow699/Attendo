import { pool } from "../db.js";

export async function requireDevice(req, res, next) {
  const key = req.headers["x-device-key"];
  if (!key) return res.status(401).json({ error: "Missing X-Device-Key header" });

  try {
    const result = await pool.query("SELECT id, label FROM devices WHERE device_key=$1", [key]);
    if (!result.rows.length) return res.status(401).json({ error: "Unknown device key" });

    req.device = result.rows[0];

    await pool.query("UPDATE devices SET status='online', last_seen=now() WHERE id=$1", [
      req.device.id,
    ]);

    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
}
