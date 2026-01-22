import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/ratings?user_id=103007
router.get("/", async (req, res) => {
  try {
    const userId = Number(req.query.user_id);
    if (!userId) return res.status(400).json({ message: "user_id is required" });

    const [rows] = await pool.query(
      `SELECT r.user_id, r.movie_id, r.rating_score, r.rated_at, m.main_title
       FROM ratings r
       JOIN movies m ON m.movie_id = r.movie_id
       WHERE r.user_id=?
       ORDER BY r.rated_at DESC
       LIMIT 100`,
      [userId]
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
