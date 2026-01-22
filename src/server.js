import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import moviesRouter from "./routes/movies.routes.js";
import ratingsRouter from "./routes/ratings.routes.js";
import chatRouter from "./routes/chat.routes.js";

const app = express();
app.use(cors());
app.use(express.json());

// health check
app.get("/health", (req, res) => res.json({ ok: true }));

// test DB connection
app.get("/db-test", async (req, res) => {
  const [rows] = await pool.query("SELECT 1 AS ok");
  res.json(rows[0]);
});

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Server running on http://localhost:${port}`),
);

app.use("/api/movies", moviesRouter);
app.use("/api/ratings", ratingsRouter);
app.use("/api/chat", chatRouter);
