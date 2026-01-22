import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/chat/sessions?user_id=103007
router.get("/sessions", async (req, res) => {
  try {
    const userId = Number(req.query.user_id);
    if (!userId) return res.status(400).json({ message: "user_id is required" });

    const [rows] = await pool.query(
      `SELECT session_id, user_id, title, started_at, ended_at
       FROM chat_sessions
       WHERE user_id=?
       ORDER BY started_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/sessions/:sessionId/messages
router.get("/sessions/:sessionId/messages", async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const [rows] = await pool.query(
      `SELECT message_id, role, content, created_at
       FROM chat_messages
       WHERE session_id=?
       ORDER BY created_at ASC`,
      [sessionId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/sessions/:sessionId/signals
router.get("/sessions/:sessionId/signals", async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    const [rows] = await pool.query(
      `SELECT signal_id, signal_type, signal_value, confidence, created_at
       FROM chat_signals
       WHERE session_id=?
       ORDER BY created_at ASC`,
      [sessionId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/chat/sessions
router.post("/sessions", async (req, res) => {
  try {
    const { user_id, title } = req.body;
    if (!user_id) return res.status(400).json({ message: "user_id is required" });

    // check user exists 
    const [u] = await pool.query(`SELECT user_id FROM users WHERE user_id=?`, [user_id]);
    if (!u.length) return res.status(400).json({ message: "user_id not found" });

    const [result] = await pool.query(
      `INSERT INTO chat_sessions (user_id, title) VALUES (?, ?)`,
      [user_id, title || "Chat session"]
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
  const dislike = /(^|\s)(dislike|hate|don't like|do not like)(\s|$)/i.test(original);

  // Basic genre mapping (extend freely)
  const genreMap = [
    { key: "action", value: "Action" },
    { key: "sci-fi", value: "Sci-Fi" },
    { key: "science fiction", value: "Sci-Fi" },
    { key: "comedy", value: "Comedy" },
    { key: "romance", value: "Romance" },
    { key: "horror", value: "Horror" },
    { key: "drama", value: "Drama" },
    { key: "thriller", value: "Thriller" },
    { key: "animation", value: "Animation" },
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
    original.match(/before\s+(\d{4})/i) ||
    original.match(/until\s+(\d{4})/i);

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
router.post("/sessions/:sessionId/messages", async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const { user_id, message } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ message: "user_id and message are required" });
    }

    // 1) Validate session
    const [s] = await pool.query(
      `SELECT session_id, user_id FROM chat_sessions WHERE session_id=?`,
      [sessionId]
    );
    if (!s.length) return res.status(404).json({ message: "Session not found" });

    // 2) Ensure session belongs to user (avoid writing to someone else's session)
    if (s[0].user_id !== Number(user_id)) {
      return res.status(403).json({ message: "Session does not belong to user" });
    }

    // 3) Insert user message
    const [msgResult] = await pool.query(
      `INSERT INTO chat_messages (session_id, user_id, role, content)
       VALUES (?, ?, 'user', ?)`,
      [sessionId, user_id, message]
    );
    const messageId = msgResult.insertId;

    // 4) Extract + insert signals
    const signals = extractSignals(message);

    if (signals.length) {
      const values = signals.map((sig) => [
        sessionId,
        user_id,
        messageId,
        sig.signal_type,
        sig.signal_value,
        sig.confidence ?? null,
      ]);

      // Bulk insert
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
