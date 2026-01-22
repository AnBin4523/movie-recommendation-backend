import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/movies?limit=20&offset=0&q=batman
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const offset = Number(req.query.offset || 0);
    const q = (req.query.q || "").trim();

    if (q) {
      const [rows] = await pool.query(
        `SELECT movie_id, main_title, year_published, rate, genres
         FROM movies
         WHERE main_title LIKE ?
         ORDER BY rate DESC
         LIMIT ? OFFSET ?`,
        [`%${q}%`, limit, offset]
      );
      return res.json(rows);
    }

    const [rows] = await pool.query(
      `SELECT movie_id, main_title, year_published, rate, genres
       FROM movies
       ORDER BY movie_id
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/movies/:id
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM movies WHERE movie_id=?`, [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ message: "Movie not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
