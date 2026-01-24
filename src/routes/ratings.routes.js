import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";

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

/**
 * GET /api/ratings/user
 * get ratings of logged in user
 */
router.get("/user", requireAuth, async (req, res) => {
  try {
    const userId = req.user.linked_user_id;
    if (!userId) return res.status(400).json({ message: "Account not linked_user_id" });

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

/**
 * POST /api/ratings
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.linked_user_id;
    const { movie_id, rating_score } = req.body;

    if (!userId) return res.status(400).json({ message: "Account not linked_user_id" });
    if (!movie_id || rating_score === undefined) {
      return res.status(400).json({ message: "movie_id and rating_score are required" });
    }

    const score = Number(rating_score);
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      return res.status(400).json({ message: "rating_score must be 1..10" });
    }

    // Check movie exists
    const [m] = await pool.query(`SELECT movie_id FROM movies WHERE movie_id=?`, [movie_id]);
    if (!m.length) return res.status(404).json({ message: "Movie not found" });

    // UPSERT: rate again if exists
    await pool.query(
      `INSERT INTO ratings (user_id, movie_id, rating_score, rated_at)
       VALUES (?, ?, ?, CURDATE())
       ON DUPLICATE KEY UPDATE
         rating_score = VALUES(rating_score),
         rated_at = VALUES(rated_at)`,
      [userId, movie_id, score]
    );

    return res.status(201).json({
      message: "Rating saved",
      user_id: userId,
      movie_id,
      rating_score: score,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
