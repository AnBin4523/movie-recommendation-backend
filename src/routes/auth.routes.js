import { Router } from "express";
import { pool } from "../db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

function isValidEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

/**
 * POST /api/auth/signup
 * body: { email, password }
 */
router.post("/signup", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, password } = req.body;

    // 1) Validate input
    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT_SECRET is missing in .env" });
    }

    // 2) Check email exists (outside transaction also ok, but still handle race)
    const [exists] = await conn.query(
      "SELECT account_id FROM app_accounts WHERE email = ? LIMIT 1",
      [email]
    );
    if (exists.length) {
      return res.status(409).json({ message: "Email already exists" });
    }

    // 3) Transaction
    await conn.beginTransaction();

    // 4) Lock rows for safe MAX+1 (simple approach)
    // Use FOR UPDATE to prevent concurrent reads causing same new_user_id
    const [[{ new_user_id }]] = await conn.query(
      "SELECT IFNULL(MAX(user_id), 0) + 1 AS new_user_id FROM users FOR UPDATE"
    );

    // 5) Create a users row
    await conn.query(
      "INSERT INTO users (user_id, account_creation_year, created_at) VALUES (?, YEAR(NOW()), NOW())",
      [new_user_id]
    );

    // 6) Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // 7) Create app account linked to users.user_id
    const [result] = await conn.query(
      `INSERT INTO app_accounts (email, password_hash, role, linked_user_id)
       VALUES (?, ?, 'user', ?)`,
      [email, password_hash, new_user_id]
    );

    // 8) Commit
    await conn.commit();

    // 9) Sign token
    const token = jwt.sign(
      {
        account_id: result.insertId,
        role: "user",
        linked_user_id: new_user_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      account_id: result.insertId,
      email,
      role: "user",
      linked_user_id: new_user_id,
      token,
    });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}

    // Duplicate email / duplicate linked_user_id fallback (race condition)
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Duplicate entry (email or linked_user_id)" });
    }

    return res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/auth/login
 * body: { email, password }
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT_SECRET is missing in .env" });
    }

    const [rows] = await pool.query(
      `SELECT account_id, email, password_hash, role, linked_user_id, is_active
       FROM app_accounts
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });

    const acc = rows[0];
    if (acc.is_active === 0) return res.status(403).json({ message: "Account is inactive" });

    const ok = await bcrypt.compare(password, acc.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      {
        account_id: acc.account_id,
        role: acc.role,
        linked_user_id: acc.linked_user_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      account_id: acc.account_id,
      email: acc.email,
      role: acc.role,
      linked_user_id: acc.linked_user_id,
      token,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { account_id } = req.user;

    // Verify account still exists and is active
    const [rows] = await pool.query(
      `SELECT account_id, email, role, linked_user_id, is_active
       FROM app_accounts
       WHERE account_id = ?
       LIMIT 1`,
      [account_id]
    );

    if (!rows.length) return res.status(401).json({ message: "Account not found" });
    const acc = rows[0];
    if (acc.is_active === 0) return res.status(403).json({ message: "Account is inactive" });

    return res.json({
      account_id: acc.account_id,
      email: acc.email,
      role: acc.role,
      linked_user_id: acc.linked_user_id,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
