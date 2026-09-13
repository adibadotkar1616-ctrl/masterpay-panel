const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";

if (process.env.NODE_ENV === "production" && JWT_SECRET === "CHANGE_ME_IN_PRODUCTION") {
  throw new Error("JWT_SECRET must be set in production.");
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    })
  : null;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

function requireDb(res) {
  if (!pool) {
    res.status(503).json({ ok: false, message: "Database is not configured. Set DATABASE_URL." });
    return false;
  }
  return true;
}

function signUser(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

function auth(req, res, next) {
  const token = req.cookies.mp_session;
  if (!token) return res.status(401).json({ ok: false, message: "Please log in." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie("mp_session");
    return res.status(401).json({ ok: false, message: "Session expired." });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, message: "Admin access required." });
  }
  next();
}

app.get("/api/health", async (_req, res) => {
  if (!pool) return res.json({ ok: true, database: "not configured" });
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  if (!requireDb(res)) return;
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ ok: false, message: "Name, email and an 8+ character password are required." });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  try {
    const exists = await pool.query("SELECT id FROM users WHERE email=$1", [normalizedEmail]);
    if (exists.rowCount) return res.status(409).json({ ok: false, message: "Email is already registered." });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3)
       RETURNING id,name,email,role,status,kyc_status,wallet_balance`,
      [String(name).trim(), normalizedEmail, hash]
    );
    const user = result.rows[0];
    res.cookie("mp_session", signUser(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 2 * 60 * 60 * 1000
    });
    res.status(201).json({ ok: true, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Registration failed." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  if (!requireDb(res)) return;
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, message: "Email and password are required." });
  try {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [String(email).trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ ok: false, message: "Invalid email or password." });
    }
    if (user.status !== "active") return res.status(403).json({ ok: false, message: "Account is suspended." });
    res.cookie("mp_session", signUser(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 2 * 60 * 60 * 1000
    });
    res.json({ ok: true, user: {
      id:user.id,name:user.name,email:user.email,role:user.role,status:user.status,
      kyc_status:user.kyc_status,wallet_balance:user.wallet_balance
    }});
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Login failed." });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("mp_session");
  res.json({ ok: true });
});

app.get("/api/me", auth, async (req, res) => {
  if (!requireDb(res)) return;
  const result = await pool.query(
    `SELECT id,name,email,role,status,kyc_status,wallet_balance,created_at
     FROM users WHERE id=$1`, [req.user.sub]
  );
  if (!result.rowCount) return res.status(404).json({ ok:false, message:"User not found." });
  res.json({ ok:true, user:result.rows[0] });
});

app.get("/api/transactions", auth, async (req, res) => {
  if (!requireDb(res)) return;
  const result = await pool.query(
    `SELECT id,type,amount,status,reference,created_at
     FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.user.sub]
  );
  res.json({ ok:true, transactions:result.rows });
});

app.get("/api/banks", auth, async (req, res) => {
  if (!requireDb(res)) return;
  const result = await pool.query(
    `SELECT id,bank_name,account_holder,account_last4,status,created_at
     FROM bank_accounts WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user.sub]
  );
  res.json({ ok:true, banks:result.rows });
});

/*
  Financial safety boundary:
  Deposit/withdrawal routes intentionally do NOT credit/debit balances.
  Add a verified payment-provider webhook and an auditable server-side ledger
  before enabling any real-money movement.
*/

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  if (!requireDb(res)) return;
  const result = await pool.query(
    `SELECT id,name,email,role,status,kyc_status,wallet_balance,created_at
     FROM users ORDER BY created_at DESC LIMIT 500`
  );
  res.json({ ok:true, users:result.rows });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`MASTERPAY listening on ${PORT}`));
