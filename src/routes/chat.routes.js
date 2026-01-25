import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/chat/sessions  (logged-in user)
router.get("/sessions", requireAuth, async (req, res) => {
  try {
    const userId = req.user.linked_user_id;
    if (!userId)
      return res.status(400).json({ message: "Account not linked_user_id" });

    const [rows] = await pool.query(
      `SELECT session_id, user_id, title, started_at, ended_at
       FROM chat_sessions
       WHERE user_id=?
       ORDER BY started_at DESC
       LIMIT 50`,
      [userId],
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/sessions/:sessionId/messages
router.get("/sessions/:sessionId/messages", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const userId = req.user.linked_user_id;

    const [s] = await pool.query(
      `SELECT session_id, user_id FROM chat_sessions WHERE session_id=?`,
      [sessionId],
    );
    if (!s.length)
      return res.status(404).json({ message: "Session not found" });
    if (s[0].user_id !== Number(userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const [rows] = await pool.query(
      `SELECT message_id, role, content, created_at
       FROM chat_messages
       WHERE session_id=?
       ORDER BY created_at ASC`,
      [sessionId],
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/sessions/:sessionId/recommendations
router.get(
  "/sessions/:sessionId/recommendations",
  requireAuth,
  async (req, res) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const userId = req.user.linked_user_id;
      const limit = Math.min(Number(req.query.limit || 20), 50);

      if (!userId)
        return res.status(400).json({ message: "Account not linked_user_id" });

      // 1) Check session belongs to user
      const [s] = await pool.query(
        `SELECT session_id, user_id FROM chat_sessions WHERE session_id=?`,
        [sessionId],
      );
      if (!s.length)
        return res.status(404).json({ message: "Session not found" });
      if (s[0].user_id !== Number(userId))
        return res.status(403).json({ message: "Forbidden" });

      // 2) Load signals of session
      const [sigRows] = await pool.query(
        `SELECT signal_type, signal_value
       FROM chat_signals
       WHERE session_id=?
       ORDER BY created_at ASC`,
        [sessionId],
      );

      // 3) Parse signals
      const likeGenres = [];
      const dislikeGenres = [];
      let yearMin = null;
      let yearMax = null;

      for (const r of sigRows) {
        if (r.signal_type === "like_genre") likeGenres.push(r.signal_value);
        if (r.signal_type === "dislike_genre")
          dislikeGenres.push(r.signal_value);
        if (r.signal_type === "year_min") yearMin = Number(r.signal_value);
        if (r.signal_type === "year_max") yearMax = Number(r.signal_value);
      }

      // No signals: return top-rated movies
      if (!likeGenres.length && !yearMin && !yearMax) {
        const [rows] = await pool.query(
          `SELECT movie_id, main_title, year_published, rate, genres
         FROM movies
         ORDER BY rate DESC
         LIMIT ?`,
          [limit],
        );
        return res.json({
          basis: { likeGenres, dislikeGenres, yearMin, yearMax },
          movies: rows,
        });
      }

      // 4) Build dynamic SQL
      const where = [];
      const params = [];

      // year filters
      if (yearMin) {
        where.push("m.year_published >= ?");
        params.push(yearMin);
      }
      if (yearMax) {
        where.push("m.year_published <= ?");
        params.push(yearMax);
      }

      // include liked genres (OR)
      if (likeGenres.length) {
        const orParts = likeGenres.map(() => "m.genres LIKE ?");
        where.push("(" + orParts.join(" OR ") + ")");
        likeGenres.forEach((g) => params.push(`%${g}%`));
      }

      // exclude disliked genres (AND NOT)
      if (dislikeGenres.length) {
        dislikeGenres.forEach((g) => {
          where.push("m.genres NOT LIKE ?");
          params.push(`%${g}%`);
        });
      }

      // avoid movies already rated by this user
      where.push(
        `NOT EXISTS (
        SELECT 1 FROM ratings r
        WHERE r.user_id = ? AND r.movie_id = m.movie_id
      )`,
      );
      params.push(userId);

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // 5) Query recommendations
      const [movies] = await pool.query(
        `SELECT m.movie_id, m.main_title, m.year_published, m.rate, m.genres
       FROM movies m
       ${whereSql}
       ORDER BY m.rate DESC
       LIMIT ?`,
        [...params, limit],
      );

      return res.json({
        basis: { likeGenres, dislikeGenres, yearMin, yearMax },
        movies,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  },
);

// POST /api/chat/sessions  (logged-in user)
router.post("/sessions", requireAuth, async (req, res) => {
  try {
    const userId = req.user.linked_user_id;
    const { title } = req.body;

    if (!userId)
      return res.status(400).json({ message: "Account not linked_user_id" });

    const [result] = await pool.query(
      `INSERT INTO chat_sessions (user_id, title) VALUES (?, ?)`,
      [userId, title || "Chat session"],
    );

    res.status(201).json({ session_id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function extractSignals(text) {
  const original = text || "";
  const t = original.toLowerCase();

  const signals = [];

  // Detect like/dislike intent
  const like = /(^|\s)(like|love|enjoy|prefer)(\s|$)/i.test(original);
  const dislike = /(^|\s)(dislike|hate|don't like|do not like)(\s|$)/i.test(
    original,
  );

  // Basic genre mapping (extend freely)
  const genreMap = [
    { key: "action", value: "Acción" },
    { key: "sci-fi", value: "Ciencia ficción" },
    { key: "science fiction", value: "Ciencia ficción" },
    { key: "comedy", value: "Comedia" },
    { key: "drama", value: "Drama" },
    { key: "thriller", value: "Thriller" },
    { key: "romance", value: "Romance" },
    { key: "animation", value: "Animación" },
    { key: "adventure", value: "Aventuras" },
  ];

  for (const g of genreMap) {
    if (t.includes(g.key)) {
      signals.push({
        signal_type: dislike ? "dislike_genre" : "like_genre",
        signal_value: g.value,
        confidence: like || dislike ? 0.9 : 0.6,
      });
    }
  }

  // year_min: "after 2015", "since 2015", "from 2015"
  const afterMatch =
    original.match(/after\s+(\d{4})/i) ||
    original.match(/since\s+(\d{4})/i) ||
    original.match(/from\s+(\d{4})/i);

  if (afterMatch) {
    signals.push({
      signal_type: "year_min",
      signal_value: String(afterMatch[1]),
      confidence: 1.0,
    });
  }

  // year_max: "before 2010", "until 2010"
  const beforeMatch =
    original.match(/before\s+(\d{4})/i) || original.match(/until\s+(\d{4})/i);

  if (beforeMatch) {
    signals.push({
      signal_type: "year_max",
      signal_value: String(beforeMatch[1]),
      confidence: 1.0,
    });
  }

  // Remove duplicates by (type + value)
  const seen = new Set();
  return signals.filter((s) => {
    const k = `${s.signal_type}:${s.signal_value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// POST /api/chat/sessions/:sessionId/messages
router.post("/sessions/:sessionId/messages", requireAuth, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const userId = req.user?.linked_user_id;
    const { message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ message: "message is required" });
    }

    // 1) Validate session
    const [s] = await pool.query(
      `SELECT session_id, user_id FROM chat_sessions WHERE session_id=?`,
      [sessionId]
    );
    if (!s.length) return res.status(404).json({ message: "Session not found" });

    // 2) Ensure session belongs to logged-in user
    if (s[0].user_id !== Number(userId)) {
      return res.status(403).json({ message: "Session does not belong to user" });
    }

    // 3) Insert user message
    const [msgResult] = await pool.query(
      `INSERT INTO chat_messages (session_id, user_id, role, content)
       VALUES (?, ?, 'user', ?)`,
      [sessionId, userId, message]
    );
    const messageId = msgResult.insertId;

    // 4) Extract + insert signals 
    const signals = extractSignals(message);

    if (signals.length) {
      const values = signals.map((sig) => [
        sessionId,
        userId,
        messageId,
        sig.signal_type,
        sig.signal_value,
        sig.confidence ?? null,
      ]);

      await pool.query(
        `INSERT INTO chat_signals
         (session_id, user_id, message_id, signal_type, signal_value, confidence)
         VALUES ?`,
        [values]
      );
    }

    return res.status(201).json({
      message_id: messageId,
      inserted_signals: signals,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
