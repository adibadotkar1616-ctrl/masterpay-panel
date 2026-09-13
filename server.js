const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const path = require("path");

const app = express();
// Render terminates HTTPS at its proxy. Trust the proxy so req.protocol
// correctly reflects the original HTTPS request used by the browser.
app.set("trust proxy", 1);
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

async function ensurePaymentSettings(){
  if(!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY CHECK (id=1),
      bank_name TEXT NOT NULL DEFAULT 'Bank of India',
      account_holder TEXT NOT NULL DEFAULT 'Rohit Nagar',
      account_number TEXT NOT NULL DEFAULT '992618210001746',
      ifsc_code TEXT NOT NULL DEFAULT 'BKID0008856',
      upi_id TEXT NOT NULL DEFAULT 'rohitnagar3870@ibl',
      upi_name TEXT NOT NULL DEFAULT 'ROHIT NARAYANSINGH',
      qr_image_url TEXT NOT NULL DEFAULT '/assets/upi-qr.jpeg',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO payment_settings(id) VALUES(1)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS utr TEXT`);
}

async function ensureDemoTables(){
  if(!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id,created_at DESC)`);
}

async function ensureAdminAccount(){
  if(!pool) return;
  const email=String(process.env.ADMIN_EMAIL||"").trim().toLowerCase();
  const password=String(process.env.ADMIN_PASSWORD||"");
  const name=String(process.env.ADMIN_NAME||"MASTERPAY Admin").trim()||"MASTERPAY Admin";
  if(!email && !password) return;
  if(!email || !password || password.length < 8){
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required; ADMIN_PASSWORD must be at least 8 characters.");
  }
  const hash=await bcrypt.hash(password,12);
  const existing=await pool.query("SELECT id FROM users WHERE email=$1",[email]);
  if(existing.rowCount){
    await pool.query(
      "UPDATE users SET name=$1,password_hash=$2,role='admin',status='active',updated_at=NOW() WHERE email=$3",
      [name,hash,email]
    );
  }else{
    await pool.query(
      "INSERT INTO users(name,email,password_hash,role,status) VALUES($1,$2,$3,'admin','active')",
      [name,email,hash]
    );
  }
}

const defaultPaymentSettings = {
  bank_name:'Bank of India', account_holder:'Rohit Nagar', account_number:'992618210001746',
  ifsc_code:'BKID0008856', upi_id:'rohitnagar3870@ibl', upi_name:'ROHIT NARAYANSINGH',
  qr_image_url:'/assets/upi-qr.jpeg'
};

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

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    const expected = `${req.protocol}://${req.get("host")}`;
    if (origin !== expected) {
      return res.status(403).json({ ok:false, message:"Invalid request origin." });
    }
  }
  next();
}

const DEMO_COMMISSION_RATE = 0.07;

const DEMO_SEQUENCE = [
  {type:'deposit',  multiplier:0.84, name:'Kavita Desai'},
  {type:'deposit',  multiplier:0.66, name:'Vikram Singh'},
  {type:'withdrawal', multiplier:0.54, name:'Neha Joshi'},
  {type:'deposit',  multiplier:0.72, name:'Rahul Yadav'},
  {type:'withdrawal', multiplier:0.48, name:'Meera Kapoor'},
  {type:'deposit',  multiplier:0.60, name:'Priya Verma'},
  {type:'deposit',  multiplier:0.42, name:'Anjali Gupta'},
  {type:'withdrawal', multiplier:0.36, name:'Sakshi Patel'},
  {type:'deposit',  multiplier:0.54, name:'Arjun Mehta'},
  {type:'withdrawal', multiplier:0.30, name:'Riya Sharma'},
  {type:'deposit',  multiplier:0.30, name:'Nitin Kumar'},
  {type:'withdrawal', multiplier:0.24, name:'Pooja Jain'},
  {type:'deposit',  multiplier:0.84, name:'Aarav Shah'},
  {type:'withdrawal', multiplier:0.42, name:'Simran Kaur'},
  {type:'deposit',  multiplier:0.72, name:'Manish Gupta'},
  {type:'withdrawal', multiplier:0.36, name:'Isha Mehta'},
  {type:'deposit',  multiplier:0.60, name:'Rohan Verma'},
  {type:'withdrawal', multiplier:0.30, name:'Nisha Patel'},
  {type:'deposit',  multiplier:0.54, name:'Aditya Jain'},
  {type:'withdrawal', multiplier:0.24, name:'Pallavi Singh'},
  {type:'deposit',  multiplier:0.54, name:'Karan Malhotra'},
  {type:'withdrawal', multiplier:0.24, name:'Divya Sharma'},
  {type:'deposit',  multiplier:0.42, name:'Sonal Kapoor'},
  {type:'withdrawal', multiplier:0.18, name:'Vivek Joshi'}
];

function demoRef(prefix){
  return `SIM-DEMO-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}

function moneyForDb(v){
  return `₹${Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

async function ensureDemoStreamTable(){
  if(!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_streams (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      seed_amount NUMERIC(14,2) NOT NULL,
      next_index INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE demo_streams ADD COLUMN IF NOT EXISTS next_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
}

async function startDemoStream(client, userId, seedAmount){
  // Every new deposit starts a fresh demo run from a clean ZERO wallet.
  // Only rows created by the demo stream are cleared; the real/pending deposit
  // request itself is kept. The wallet is a test wallet in this application.
  await client.query(`DELETE FROM transactions WHERE user_id=$1 AND reference LIKE 'SIM-DEMO-%'`,[userId]);
  await client.query(`DELETE FROM notifications WHERE user_id=$1 AND title IN ('CREDIT ALERT','DEBIT ALERT')`,[userId]);
  await client.query(`UPDATE users SET wallet_balance=0 WHERE id=$1`,[userId]);
  await client.query(
    `INSERT INTO demo_streams(user_id,seed_amount,next_index,active,updated_at,next_at)
     VALUES($1,$2,0,TRUE,NOW(),NOW())
     ON CONFLICT(user_id) DO UPDATE SET seed_amount=EXCLUDED.seed_amount,next_index=0,active=TRUE,updated_at=NOW(),next_at=NOW()`,
    [userId, Number(seedAmount).toFixed(2)]
  );
  return true;
}

// Generates exactly ONE demo transaction per call. The browser calls this
// periodically, so the user sees credits/debits and notifications arrive one
// at a time instead of all being inserted at once.
async function generateNextDemoTransaction(userId){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const stream = await client.query(
      `SELECT user_id,seed_amount,next_index,active,next_at
       FROM demo_streams WHERE user_id=$1 FOR UPDATE`, [userId]
    );
    if(!stream.rowCount || !stream.rows[0].active){
      await client.query('COMMIT');
      return {generated:false,active:false};
    }

    const row=stream.rows[0];
    const index=Number(row.next_index||0);
    const nextAt=row.next_at ? new Date(row.next_at).getTime() : Date.now();
    const now=Date.now();
    if(now < nextAt){
      await client.query('COMMIT');
      return {generated:false,active:true,waitSeconds:Math.ceil((nextAt-now)/1000)};
    }
    if(index >= DEMO_SEQUENCE.length){
      await client.query(`UPDATE demo_streams SET active=FALSE,updated_at=NOW() WHERE user_id=$1`,[userId]);
      await client.query('COMMIT');
      return {generated:false,active:false};
    }

    const spec=DEMO_SEQUENCE[index];
    const amount=Number((Number(row.seed_amount)*spec.multiplier).toFixed(2));
    const commission=spec.type==='deposit' ? Number((amount*DEMO_COMMISSION_RATE).toFixed(2)) : 0;
    const reference=demoRef(spec.type==='deposit'?'CREDIT':'DEBIT');

    await client.query(
      `INSERT INTO transactions(user_id,type,amount,status,reference,created_at)
       VALUES($1,$2,$3,'completed',$4,NOW())`,
      [userId,spec.type,amount.toFixed(2),reference]
    );

    await client.query(
      `INSERT INTO notifications(user_id,title,body,created_at)
       VALUES($1,$2,$3,NOW())`,
      [userId,
       `${spec.type==='deposit'?'CREDIT':'DEBIT'} ALERT`,
       `${spec.name}: ${spec.type==='deposit'?'credited':'debited'} ${moneyForDb(amount)}${commission ? `. Commission earned: ${moneyForDb(commission)}.` : '.'}`]
    );

    // Credit adds the transaction amount plus its 7% commission. Debit subtracts
    // only the debit amount. This makes the demo wallet move entry-by-entry.
    const walletDelta=spec.type==='deposit' ? amount+commission : -amount;
    const updated=await client.query(
      `UPDATE users SET wallet_balance=COALESCE(wallet_balance,0)+$1
       WHERE id=$2 RETURNING wallet_balance`,
      [walletDelta.toFixed(2),userId]
    );

    const nextIndex=index+1;
    const active=nextIndex<DEMO_SEQUENCE.length;
    const delaySeconds=15000 + Math.floor(Math.random()*10001);
    await client.query(
      `UPDATE demo_streams SET next_index=$1,active=$2,updated_at=NOW(),next_at=CASE WHEN $2 THEN NOW() + ($3 * INTERVAL '1 millisecond') ELSE NOW() END WHERE user_id=$4`,
      [nextIndex,active,delaySeconds,userId]
    );
    await client.query('COMMIT');
    return {
      generated:true,
      active:nextIndex<DEMO_SEQUENCE.length,
      type:spec.type,
      amount,
      commission,
      wallet_balance:Number(updated.rows[0]?.wallet_balance||0),
      index:nextIndex,
      nextInSeconds:active ? Math.round(delaySeconds/1000) : 0
    };
  }catch(e){
    try{await client.query('ROLLBACK');}catch{}
    throw e;
  }finally{client.release();}
}

app.get("/api/banks", auth, async (req, res) => {
  if (!requireDb(res)) return;
  const result = await pool.query(
    `SELECT id,bank_name,account_type,account_holder,account_last4,ifsc_code,mobile_number,status,created_at
     FROM bank_accounts WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user.sub]
  );
  res.json({ ok:true, banks:result.rows });
});

app.post("/api/banks", auth, requireSameOrigin, async (req, res) => {
  if (!requireDb(res)) return;
  const { bank_name, account_type, account_holder, account_number, ifsc_code, mobile_number } = req.body || {};
  const bankName = String(bank_name || "").trim();
  const accountType = String(account_type || "").trim().toLowerCase();
  const holder = String(account_holder || "").trim();
  const accountNumber = String(account_number || "").replace(/\s+/g, "");
  const ifsc = String(ifsc_code || "").trim().toUpperCase();
  const mobile = String(mobile_number || "").replace(/\D/g, "");
  if (!bankName || bankName.length > 120 || !["savings","current","corporate"].includes(accountType) || !holder || holder.length > 120 || !/^\d{6,24}$/.test(accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) || !/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ ok:false, message:"Enter valid bank, account type, account number, IFSC code, account holder name and 10-digit mobile number." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO bank_accounts(user_id,bank_name,account_type,account_holder,account_last4,ifsc_code,mobile_number,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'pending')
       RETURNING id,bank_name,account_type,account_holder,account_last4,ifsc_code,mobile_number,status,created_at`,
      [req.user.sub, bankName, accountType, holder, accountNumber.slice(-4), ifsc, mobile]
    );
    res.status(201).json({ ok:true, bank:result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Could not add bank account." });
  }
});

app.delete("/api/banks/:id", auth, requireSameOrigin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const result = await pool.query(
      `DELETE FROM bank_accounts WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.sub]
    );
    if (!result.rowCount) return res.status(404).json({ ok:false, message:"Bank account not found." });
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Could not remove bank account." });
  }
});

app.get("/api/payment-settings", auth, async (_req, res) => {
  if (!requireDb(res)) return;
  try {
    const result = await pool.query(`SELECT bank_name,account_holder,account_number,ifsc_code,upi_id,upi_name,qr_image_url FROM payment_settings WHERE id=1`);
    res.json({ ok:true, settings: result.rows[0] || defaultPaymentSettings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Could not load payment settings." });
  }
});

app.get("/api/admin/payment-settings", auth, adminOnly, async (_req, res) => {
  if (!requireDb(res)) return;
  try {
    const result = await pool.query(`SELECT bank_name,account_holder,account_number,ifsc_code,upi_id,upi_name,qr_image_url,updated_at FROM payment_settings WHERE id=1`);
    res.json({ ok:true, settings: result.rows[0] || defaultPaymentSettings });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Could not load payment settings." });
  }
});

app.put("/api/admin/payment-settings", auth, adminOnly, requireSameOrigin, async (req, res) => {
  if (!requireDb(res)) return;
  const body=req.body||{};
  const settings={
    bank_name:String(body.bank_name||'').trim(),
    account_holder:String(body.account_holder||'').trim(),
    account_number:String(body.account_number||'').replace(/\s+/g,''),
    ifsc_code:String(body.ifsc_code||'').trim().toUpperCase(),
    upi_id:String(body.upi_id||'').trim(),
    upi_name:String(body.upi_name||'').trim(),
    qr_image_url:String(body.qr_image_url||'').trim()
  };
  if(!settings.bank_name || settings.bank_name.length>120 || !settings.account_holder || settings.account_holder.length>120 || !/^\d{6,24}$/.test(settings.account_number) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(settings.ifsc_code) || !/^[^\s@]+@[^\s@]+$/.test(settings.upi_id) || !settings.upi_name || settings.upi_name.length>120 || !settings.qr_image_url || settings.qr_image_url.length>200000){
    return res.status(400).json({ok:false,message:"Enter valid bank, account, IFSC, UPI and QR image details."});
  }
  try {
    const result=await pool.query(`
      INSERT INTO payment_settings(id,bank_name,account_holder,account_number,ifsc_code,upi_id,upi_name,qr_image_url,updated_at)
      VALUES(1,$1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT(id) DO UPDATE SET bank_name=EXCLUDED.bank_name,account_holder=EXCLUDED.account_holder,account_number=EXCLUDED.account_number,ifsc_code=EXCLUDED.ifsc_code,upi_id=EXCLUDED.upi_id,upi_name=EXCLUDED.upi_name,qr_image_url=EXCLUDED.qr_image_url,updated_at=NOW()
      RETURNING bank_name,account_holder,account_number,ifsc_code,upi_id,upi_name,qr_image_url,updated_at`,
      [settings.bank_name,settings.account_holder,settings.account_number,settings.ifsc_code,settings.upi_id,settings.upi_name,settings.qr_image_url]
    );
    res.json({ok:true,settings:result.rows[0],message:"Payment settings updated successfully."});
  } catch(e){
    console.error(e);
    res.status(500).json({ok:false,message:"Could not update payment settings."});
  }
});

app.post("/api/deposits", auth, requireSameOrigin, async (req, res) => {
  if (!requireDb(res)) return;
  const amount = Number(req.body?.amount);
  const utr = String(req.body?.utr || '').trim();
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
    return res.status(400).json({ ok:false, message:"Deposit amount must be between ₹1 and ₹10,00,000." });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{5,119}$/.test(utr)) {
    return res.status(400).json({ ok:false, message:"Enter a valid UTR / Transaction ID." });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bank = await client.query(`SELECT id,bank_name,account_last4,status FROM bank_accounts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [req.user.sub]);
    if (!bank.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok:false, message:"Add a bank account before submitting a deposit." });
    }
    const reference = `DEP-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const result = await client.query(
      `INSERT INTO transactions(user_id,type,amount,status,reference,utr)
       VALUES($1,'deposit',$2,'pending',$3,$4)
       RETURNING id,type,amount,status,reference,utr,created_at`,
      [req.user.sub, amount.toFixed(2), reference, utr]
    );
    const started = await startDemoStream(client, req.user.sub, amount);
    await client.query('COMMIT');
    res.status(201).json({
      ok:true,
      transaction:result.rows[0],
      demo:{started,active:true},
      message:"Deposit request submitted. Your demo credits and debits will arrive one by one."
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(e);
    res.status(500).json({ ok:false, message:"Could not create deposit request." });
  } finally {
    client.release();
  }
});

app.post("/api/demo/tick", auth, requireSameOrigin, async (req,res)=>{
  if(!requireDb(res)) return;
  try{
    const result=await generateNextDemoTransaction(req.user.sub);
    res.json({ok:true,...result});
  }catch(e){
    console.error(e);
    res.status(500).json({ok:false,message:"Could not generate the next demo transaction."});
  }
});

app.get("/api/commission-summary", auth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS count,
         COALESCE(SUM(amount),0) AS volume,
         COALESCE(SUM(amount) FILTER (WHERE type='deposit'),0) AS credits,
         COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),0) AS debits
       FROM transactions
       WHERE user_id=$1 AND reference LIKE 'SIM-DEMO-%'`,
      [req.user.sub]
    );
    const row=result.rows[0]||{};
    const volume=Number(row.volume||0), credits=Number(row.credits||0), debits=Number(row.debits||0);
    const commission=Number((credits*DEMO_COMMISSION_RATE).toFixed(2));
    res.json({ok:true,rate:DEMO_COMMISSION_RATE,count:Number(row.count||0),volume:volume.toFixed(2),credits:credits.toFixed(2),debits:debits.toFixed(2),net:(credits-debits).toFixed(2),commission:commission.toFixed(2),demo:true});
  } catch(e) {
    console.error(e);
    res.status(500).json({ok:false,message:"Could not load demo summary."});
  }
});

app.get("/api/notifications", auth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const result = await pool.query(
      `SELECT id,title,body,is_read,created_at
       FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.sub]
    );
    res.json({ok:true,notifications:result.rows});
  } catch(e) {
    console.error(e);
    res.status(500).json({ok:false,message:"Could not load notifications."});
  }
});

app.post("/api/notifications/read-all", auth, requireSameOrigin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    await pool.query(`UPDATE notifications SET is_read=TRUE WHERE user_id=$1`, [req.user.sub]);
    res.json({ok:true});
  } catch(e) {
    console.error(e);
    res.status(500).json({ok:false,message:"Could not update notifications."});
  }
});

app.post("/api/withdrawals", auth, requireSameOrigin, async (req, res) => {
  if (!requireDb(res)) return;
  const amount = Number(req.body?.amount);
  const bankId = String(req.body?.bank_id || "");
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000000 || !bankId) {
    return res.status(400).json({ ok:false, message:"Enter a valid withdrawal amount and bank account." });
  }
  try {
    const bank = await pool.query(
      `SELECT id FROM bank_accounts WHERE id=$1 AND user_id=$2 AND status='verified'`,
      [bankId, req.user.sub]
    );
    if (!bank.rowCount) return res.status(400).json({ ok:false, message:"Select a verified bank account." });

    const user = await pool.query(`SELECT wallet_balance FROM users WHERE id=$1`, [req.user.sub]);
    const balance = Number(user.rows[0]?.wallet_balance || 0);
    if (amount > balance) return res.status(400).json({ ok:false, message:"Insufficient available wallet balance." });

    const reference = `WDR-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const result = await pool.query(
      `INSERT INTO transactions(user_id,type,amount,status,reference)
       VALUES($1,'withdrawal',$2,'pending',$3)
       RETURNING id,type,amount,status,reference,created_at`,
      [req.user.sub, amount.toFixed(2), reference]
    );
    res.status(201).json({ ok:true, transaction:result.rows[0], message:"Withdrawal request created. Balance is unchanged until it is processed through the verified payment workflow." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Could not create withdrawal request." });
  }
});

/*
  Financial safety boundary:
  These routes create pending requests only. They do NOT credit/debit balances.
  Real deposits/withdrawals require an authorized payment provider, verified
  webhooks, an auditable ledger, and appropriate compliance controls.
*/

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  if (!requireDb(res)) return;
  const result = await pool.query(
    `SELECT id,name,email,role,status,kyc_status,wallet_balance,created_at
     FROM users ORDER BY created_at DESC LIMIT 500`
  );
  res.json({ ok:true, users:result.rows });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

(async()=>{
  try{
    await ensurePaymentSettings();
    await ensureDemoTables();
    await ensureDemoStreamTable();
    await ensureAdminAccount();
  } catch(e){
    console.error("Startup initialization failed:",e.message);
    process.exit(1);
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`MASTERPAY listening on ${PORT}`));
})();
