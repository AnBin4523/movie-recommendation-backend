import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

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

/**
 * ADMIN: POST /api/movies
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      movie_id,
      main_title,
      year_published,
      duration,
      country_name,
      country_code,
      original_title,
      directors,
      actors,
      genres,
      plot,
      script,
      producer,
      music,
      photography,
      rate,
      topics,
    } = req.body;

    if (!movie_id || !main_title) {
      return res.status(400).json({ message: "movie_id and main_title are required" });
    }

    await pool.query(
      `INSERT INTO movies (
        movie_id, main_title, year_published, duration,
        country_name, country_code, original_title,
        directors, actors, genres, plot, script, producer,
        music, photography, rate, topics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        movie_id,
        main_title,
        year_published ?? null,
        duration ?? null,
        country_name ?? null,
        country_code ?? null,
        original_title ?? null,
        directors ?? null,
        actors ?? null,
        genres ?? null,
        plot ?? null,
        script ?? null,
        producer ?? null,
        music ?? null,
        photography ?? null,
        rate ?? null,
        topics ?? null,
      ]
    );

    return res.status(201).json({ message: "Movie created", movie_id });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "movie_id already exists" });
    }
    return res.status(500).json({ error: e.message });
  }
});

/**
 * ADMIN: PUT /api/movies/:id
 */
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const movieId = Number(req.params.id);

    // Extract fields to update
    const {
      main_title,
      year_published,
      duration,
      genres,
      plot,
      rate,
      directors,
      actors,
      topics,
    } = req.body;

    const [result] = await pool.query(
      `UPDATE movies
       SET main_title = COALESCE(?, main_title),
           year_published = COALESCE(?, year_published),
           duration = COALESCE(?, duration),
           genres = COALESCE(?, genres),
           plot = COALESCE(?, plot),
           rate = COALESCE(?, rate),
           directors = COALESCE(?, directors),
           actors = COALESCE(?, actors),
           topics = COALESCE(?, topics)
       WHERE movie_id = ?`,
      [
        main_title ?? null,
        year_published ?? null,
        duration ?? null,
        genres ?? null,
        plot ?? null,
        rate ?? null,
        directors ?? null,
        actors ?? null,
        topics ?? null,
        movieId,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Movie not found" });
    }

    return res.json({ message: "Movie updated", movie_id: movieId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * ADMIN: DELETE /api/movies/:id
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const movieId = Number(req.params.id);

    const [result] = await pool.query(`DELETE FROM movies WHERE movie_id=?`, [movieId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Movie not found" });
    }

    return res.json({ message: "Movie deleted", movie_id: movieId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
