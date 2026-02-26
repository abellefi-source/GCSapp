/**
 * Good Car Solutions — Shared Data Server v2.6.4
 * Express + sql.js + JWT Auth + Role-Based Access
 */
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { getDb, query, run, getSetting, setSetting, saveDb, DATA_HOME } = require("./db");

const app = express();
const PORT = process.env.GCS_PORT || 3377;

// Persist JWT secret in stable data dir
const secretFile = path.join(DATA_HOME, ".jwt-secret");
// Migrate old secret if needed
const oldSecretFile = path.join(__dirname, ".jwt-secret");
if (!fs.existsSync(secretFile) && fs.existsSync(oldSecretFile)) {
  fs.copyFileSync(oldSecretFile, secretFile);
  console.log(`  [MIGRATE] Copied JWT secret to ${secretFile}`);
}
let activeSecret;
if (fs.existsSync(secretFile)) {
  activeSecret = fs.readFileSync(secretFile, "utf-8").trim();
} else {
  activeSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretFile, activeSecret);
}

// File uploads in stable data dir
const UPLOADS_DIR = path.join(DATA_HOME, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// Migrate old uploads if needed
const oldUploads = path.join(__dirname, "uploads");
if (fs.existsSync(oldUploads)) {
  const files = fs.readdirSync(oldUploads);
  let migrated = 0;
  for (const f of files) {
    const src = path.join(oldUploads, f);
    const dst = path.join(UPLOADS_DIR, f);
    if (!fs.existsSync(dst) && fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dst);
      migrated++;
    }
  }
  if (migrated > 0) console.log(`  [MIGRATE] Copied ${migrated} files to ${UPLOADS_DIR}`);
}

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── HELPERS ─────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + crypto.randomBytes(4).toString("hex"); }

function generateJobId() {
  const prefix = getSetting("defaultJobPrefix") || "GCS";
  let num = parseInt(getSetting("nextJobNumber") || "1", 10);
  const id = `${prefix}-${new Date().getFullYear()}-${String(num).padStart(4, "0")}`;
  setSetting("nextJobNumber", String(num + 1));
  return id;
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(header.slice(7), activeSecret);
    next();
  } catch (e) { return res.status(401).json({ error: "Invalid or expired token" }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const users = query("SELECT * FROM users WHERE username = ? AND active = 1", [username]);
  if (users.length === 0) return res.status(401).json({ error: "Invalid credentials" });
  const user = users[0];

  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, displayName: user.display_name },
    activeSecret, { expiresIn: "7d" }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name } });
});

app.get("/api/auth/me", authRequired, (req, res) => { res.json({ user: req.user }); });

app.post("/api/auth/change-password", authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });

  const users = query("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (users.length === 0) return res.status(404).json({ error: "User not found" });

  if (!bcrypt.compareSync(currentPassword, users[0].password_hash))
    return res.status(401).json({ error: "Current password incorrect" });

  const hash = bcrypt.hashSync(newPassword, 10);
  run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id]);
  res.json({ success: true });
});

// ─── USER MANAGEMENT (Admin) ────────────────────────────────────
app.get("/api/users", authRequired, adminOnly, (req, res) => {
  res.json({ data: query("SELECT id, username, display_name, role, active, created_at FROM users") });
});

app.post("/api/users", authRequired, adminOnly, (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  if (!["admin", "technician"].includes(role)) return res.status(400).json({ error: "Role must be admin or technician" });

  const existing = query("SELECT id FROM users WHERE username = ?", [username]);
  if (existing.length > 0) return res.status(409).json({ error: "Username already exists" });

  const hash = bcrypt.hashSync(password, 10);
  run("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    [username, hash, displayName || username, role]);
  res.json({ success: true });
});

app.put("/api/users/:id", authRequired, adminOnly, (req, res) => {
  const { displayName, role, active, password, username } = req.body;
  const id = req.params.id;
  if (username !== undefined) {
    const existing = query("SELECT id FROM users WHERE username = ? AND id != ?", [username, id]);
    if (existing.length > 0) return res.status(409).json({ error: "Username already taken" });
    run("UPDATE users SET username = ? WHERE id = ?", [username, id]);
  }
  if (displayName !== undefined) run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, id]);
  if (role !== undefined) run("UPDATE users SET role = ? WHERE id = ?", [role, id]);
  if (active !== undefined) run("UPDATE users SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
  if (password) run("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(password, 10), id]);
  res.json({ success: true });
});

app.delete("/api/users/:id", authRequired, adminOnly, (req, res) => {
  if (req.user.id === parseInt(req.params.id)) return res.status(400).json({ error: "Cannot delete yourself" });
  run("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ─── JOBS ────────────────────────────────────────────────────────
app.get("/api/jobs", authRequired, (req, res) => {
  const jobs = query("SELECT * FROM jobs ORDER BY created_at DESC");
  const enriched = jobs.map(j => {
    const timeline = query("SELECT * FROM job_timeline WHERE job_id = ? ORDER BY timestamp ASC", [j.id]);
    const payments = query("SELECT * FROM payments WHERE job_id = ? ORDER BY date ASC", [j.id]);
    return {
      id: j.id, vehicle: j.vehicle, vin: j.vin, customer: j.customer,
      customerId: j.customer_id, type: j.type, ecu: j.ecu, tools: j.tools,
      priority: j.priority, status: j.status, amount: j.amount, paid: !!j.paid,
      date: j.date, serviceAddress: j.service_address,
      scheduledStart: j.scheduled_start || "", scheduledEnd: j.scheduled_end || "",
      teamId: j.team_id || "",
      lineItems: JSON.parse(j.line_items || "[]"),
      invoiceDraft: j.invoice_draft ? JSON.parse(j.invoice_draft) : null,
      invoiceNo: j.invoice_no || "",
      createdAt: j.created_at, updatedAt: j.updated_at,
      notes: timeline.map(t => ({
        type: t.type, text: t.text, timestamp: t.timestamp, createdBy: t.created_by,
        ...(t.file_json ? { file: JSON.parse(t.file_json) } : {})
      })),
      payments: payments.map(p => ({ amount: p.amount, note: p.note, date: p.date, createdBy: p.created_by }))
    };
  });
  res.json(enriched);
});

app.post("/api/jobs", authRequired, (req, res) => {
  const d = req.body;
  const id = generateJobId();
  const now = new Date().toISOString();

  run(`INSERT INTO jobs (id, vehicle, vin, customer, customer_id, type, ecu, tools, priority, status, amount, paid, date, service_address, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, d.vehicle || "", d.vin || "", d.customer || "", d.customerId || "", d.type || "ECU Programming",
     d.ecu || "", d.tools || "", d.priority || "Medium", d.status || "Scheduled",
     d.amount || 0, d.paid ? 1 : 0, d.date || "", d.serviceAddress || "", now, now]);

  for (const entry of (d.notes || [])) {
    run("INSERT INTO job_timeline (job_id, type, text, file_json, timestamp, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [id, entry.type || "note", entry.text || "", entry.file ? JSON.stringify(entry.file) : null, entry.timestamp || now, req.user.displayName]);
  }
  for (const p of (d.payments || [])) {
    run("INSERT INTO payments (job_id, amount, note, date, created_by) VALUES (?, ?, ?, ?, ?)",
      [id, p.amount, p.note || "Payment", p.date || now, req.user.displayName]);
  }

  res.json({ ...d, id, createdAt: now, updatedAt: now });
});

app.put("/api/jobs/:id", authRequired, (req, res) => {
  const u = req.body;
  const now = new Date().toISOString();
  const jobId = req.params.id;

  const fields = { vehicle: "vehicle", vin: "vin", customer: "customer", customerId: "customer_id",
    type: "type", ecu: "ecu", tools: "tools", priority: "priority", status: "status",
    amount: "amount", paid: "paid", date: "date", serviceAddress: "service_address",
    scheduledStart: "scheduled_start", scheduledEnd: "scheduled_end", teamId: "team_id",
    invoiceNo: "invoice_no" };

  for (const [key, col] of Object.entries(fields)) {
    if (u[key] !== undefined) {
      const val = key === "paid" ? (u[key] ? 1 : 0) : u[key];
      run(`UPDATE jobs SET ${col} = ?, updated_at = ? WHERE id = ?`, [val, now, jobId]);
    }
  }

  // Handle line_items (JSON field)
  if (u.lineItems !== undefined || u.line_items !== undefined) {
    const li = u.lineItems || u.line_items || [];
    const liJson = typeof li === "string" ? li : JSON.stringify(li);
    run("UPDATE jobs SET line_items = ?, updated_at = ? WHERE id = ?", [liJson, now, jobId]);
  }

  // Handle invoice_draft (JSON field)
  if (u.invoiceDraft !== undefined || u.invoice_draft !== undefined) {
    const draft = u.hasOwnProperty("invoiceDraft") ? u.invoiceDraft : u.invoice_draft;
    const draftJson = (draft === null || draft === undefined) ? "" : (typeof draft === "string" ? draft : JSON.stringify(draft));
    run("UPDATE jobs SET invoice_draft = ?, updated_at = ? WHERE id = ?", [draftJson, now, jobId]);
  }

  if (u.notes !== undefined) {
    run("DELETE FROM job_timeline WHERE job_id = ?", [jobId]);
    for (const entry of (u.notes || [])) {
      run("INSERT INTO job_timeline (job_id, type, text, file_json, timestamp, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [jobId, entry.type || "note", entry.text || "", entry.file ? JSON.stringify(entry.file) : null, entry.timestamp || now, entry.createdBy || req.user.displayName]);
    }
  }

  if (u.payments !== undefined) {
    run("DELETE FROM payments WHERE job_id = ?", [jobId]);
    for (const p of (u.payments || [])) {
      run("INSERT INTO payments (job_id, amount, note, date, created_by) VALUES (?, ?, ?, ?, ?)",
        [jobId, p.amount, p.note || "Payment", p.date || now, p.createdBy || req.user.displayName]);
    }
  }

  // Return updated
  const jobs = query("SELECT * FROM jobs WHERE id = ?", [jobId]);
  if (jobs.length === 0) return res.status(404).json({ error: "Job not found" });
  const j = jobs[0];
  const timeline = query("SELECT * FROM job_timeline WHERE job_id = ? ORDER BY timestamp ASC", [jobId]);
  const payments = query("SELECT * FROM payments WHERE job_id = ? ORDER BY date ASC", [jobId]);
  res.json({
    ...j, paid: !!j.paid,
    notes: timeline.map(t => ({ type: t.type, text: t.text, timestamp: t.timestamp, createdBy: t.created_by, ...(t.file_json ? { file: JSON.parse(t.file_json) } : {}) })),
    payments: payments.map(p => ({ amount: p.amount, note: p.note, date: p.date, createdBy: p.created_by }))
  });
});

app.delete("/api/jobs/:id", authRequired, adminOnly, (req, res) => {
  run("DELETE FROM job_timeline WHERE job_id = ?", [req.params.id]);
  run("DELETE FROM payments WHERE job_id = ?", [req.params.id]);
  run("DELETE FROM jobs WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ─── CUSTOMERS ───────────────────────────────────────────────────
app.get("/api/customers", authRequired, (req, res) => {
  res.json(query("SELECT * FROM customers ORDER BY name ASC"));
});

app.post("/api/customers", authRequired, (req, res) => {
  const d = req.body;
  const id = d.id || uid();
  run("INSERT INTO customers (id, name, contact, phone, email, type, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, d.name || "", d.contact || "", d.phone || "", d.email || "", d.type || "Independent Shop", d.address || "", d.notes || ""]);
  res.json({ ...d, id, jobCount: 0, totalRevenue: 0, createdAt: new Date().toISOString() });
});

app.put("/api/customers/:id", authRequired, (req, res) => {
  const u = req.body;
  const cols = ["name", "contact", "phone", "email", "type", "address", "notes"];
  for (const key of cols) {
    if (u[key] !== undefined) run(`UPDATE customers SET ${key} = ? WHERE id = ?`, [u[key], req.params.id]);
  }
  const rows = query("SELECT * FROM customers WHERE id = ?", [req.params.id]);
  res.json(rows[0] || {});
});

app.delete("/api/customers/:id", authRequired, adminOnly, (req, res) => {
  run("DELETE FROM customers WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ─── KNOWLEDGE BASE ──────────────────────────────────────────────
app.get("/api/kb", authRequired, (req, res) => {
  const entries = query("SELECT * FROM kb_entries ORDER BY created_at DESC");
  const grouped = { procedures: [], dtcMaps: [], fileLibrary: [] };
  for (const e of entries) {
    if (grouped[e.category]) grouped[e.category].push({ ...e, tags: JSON.parse(e.tags || "[]") });
  }
  res.json(grouped);
});

app.post("/api/kb/:category", authRequired, (req, res) => {
  const d = req.body;
  const id = uid();
  run("INSERT INTO kb_entries (id, category, title, content, tags, updated) VALUES (?, ?, ?, ?, ?, ?)",
    [id, req.params.category, d.title || "", d.content || "", JSON.stringify(d.tags || []), d.updated || new Date().toISOString().slice(0, 10)]);
  res.json({ ...d, id, tags: d.tags || [], createdAt: new Date().toISOString() });
});

app.delete("/api/kb/:category/:id", authRequired, adminOnly, (req, res) => {
  run("DELETE FROM kb_entries WHERE id = ? AND category = ?", [req.params.id, req.params.category]);
  res.json({ success: true });
});

// ─── VEHICLES ────────────────────────────────────────────────────
app.get("/api/vehicles", authRequired, (req, res) => {
  const vehicles = query("SELECT * FROM vehicles ORDER BY make, model ASC");
  res.json(vehicles.map(v => ({
    ...v, engines: JSON.parse(v.engines || "[]"), ecus: JSON.parse(v.ecus || "[]"),
    modules: JSON.parse(v.modules || "[]"), protocols: JSON.parse(v.protocols || "[]")
  })));
});

app.post("/api/vehicles", authRequired, (req, res) => {
  const d = req.body;
  const id = uid();
  run("INSERT INTO vehicles (id, make, model, years, engines, ecus, modules, protocols, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, d.make || "", d.model || "", d.years || "", JSON.stringify(d.engines || []), JSON.stringify(d.ecus || []),
     JSON.stringify(d.modules || []), JSON.stringify(d.protocols || []), d.notes || ""]);
  res.json({ ...d, id, createdAt: new Date().toISOString() });
});

app.delete("/api/vehicles/:id", authRequired, adminOnly, (req, res) => {
  run("DELETE FROM vehicles WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ─── FILE UPLOADS ────────────────────────────────────────────────
app.post("/api/files/upload", authRequired, upload.array("files", 20), (req, res) => {
  const saved = req.files.map(f => {
    const ext = path.extname(f.originalname);
    const fileId = uid();
    const storedName = `${fileId}${ext}`;
    fs.renameSync(f.path, path.join(UPLOADS_DIR, storedName));
    return { id: fileId, originalName: f.originalname, storedName, extension: ext.toLowerCase().replace(".", ""), size: f.size, addedAt: new Date().toISOString() };
  });
  res.json(saved);
});

app.get("/api/files/:storedName", (req, res) => {
  // Accept token from header OR query param (for mobile browser links)
  const header = req.headers.authorization;
  const qToken = req.query.token;
  const token = header ? header.slice(7) : qToken;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try { jwt.verify(token, activeSecret); } catch (e) { return res.status(401).json({ error: "Invalid token" }); }

  const fp = path.join(UPLOADS_DIR, req.params.storedName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "File not found" });

  // Set proper MIME types so files display correctly in browsers
  const ext = path.extname(req.params.storedName).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.txt': 'text/plain', '.csv': 'text/csv', '.html': 'text/html',
    '.bin': 'application/octet-stream', '.hex': 'application/octet-stream',
    '.ori': 'application/octet-stream', '.mod': 'application/octet-stream',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  if (mimeTypes[ext]) res.setHeader('Content-Type', mimeTypes[ext]);
  res.setHeader('Content-Disposition', `inline; filename="${req.params.storedName}"`);
  res.sendFile(fp);
});

// ─── SETTINGS ────────────────────────────────────────────────────
app.get("/api/settings", authRequired, (req, res) => {
  const rows = query("SELECT * FROM settings");
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

app.put("/api/settings", authRequired, adminOnly, (req, res) => {
  for (const [k, v] of Object.entries(req.body)) setSetting(k, v);
  res.json({ success: true });
});

// ─── INVOICE NUMBER ──────────────────────────────────────────────
app.get("/api/invoice/next-number", authRequired, (req, res) => {
  res.json({ number: parseInt(getSetting("nextInvoiceNumber") || "14831365", 10) });
});

app.post("/api/invoice/increment-number", authRequired, (req, res) => {
  const num = parseInt(getSetting("nextInvoiceNumber") || "14831365", 10) + 1;
  setSetting("nextInvoiceNumber", String(num));
  res.json({ number: num });
});

// ─── STRIPE PAYMENT LINKS ────────────────────────────────────────
function getStripe() {
  const key = getSetting("stripeSecretKey");
  if (!key) return null;
  return require("stripe")(key);
}

// Create a payment link for an invoice
app.post("/api/stripe/payment-link", authRequired, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ error: "Stripe API key not configured. Add it in Settings." });

  const { invoiceNo, amount, customerName, customerEmail, customerPhone, description, jobId } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

  try {
    // Create a one-time price for this invoice
    const price = await stripe.prices.create({
      unit_amount: Math.round(amount * 100), // cents
      currency: "usd",
      product_data: {
        name: `Invoice #${invoiceNo || "N/A"} — Good Car Solutions`,
        metadata: { invoiceNo: String(invoiceNo || ""), jobId: jobId || "" }
      }
    });

    // Create payment link
    const linkOptions = {
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoiceNo: String(invoiceNo || ""),
        jobId: jobId || "",
        customerName: customerName || ""
      },
      after_completion: {
        type: "hosted_confirmation",
        hosted_confirmation: { custom_message: "Thank you for your payment! Good Car Solutions appreciates your business." }
      }
    };

    const paymentLink = await stripe.paymentLinks.create(linkOptions);

    // Store the link info in settings for tracking
    const links = JSON.parse(getSetting("stripePaymentLinks") || "[]");
    links.push({
      id: paymentLink.id,
      url: paymentLink.url,
      invoiceNo: invoiceNo,
      jobId: jobId || "",
      amount: amount,
      customerName: customerName || "",
      createdAt: new Date().toISOString(),
      status: "active"
    });
    setSetting("stripePaymentLinks", JSON.stringify(links));

    res.json({
      success: true,
      paymentLink: {
        id: paymentLink.id,
        url: paymentLink.url,
        amount: amount
      }
    });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// Check payment status for a link
app.get("/api/stripe/payment-status/:linkId", authRequired, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ error: "Stripe not configured" });

  try {
    // List checkout sessions for this payment link
    const sessions = await stripe.checkout.sessions.list({
      payment_link: req.params.linkId,
      limit: 10
    });

    const paid = sessions.data.some(s => s.payment_status === "paid");
    const totalPaid = sessions.data
      .filter(s => s.payment_status === "paid")
      .reduce((sum, s) => sum + (s.amount_total || 0), 0) / 100;

    res.json({
      linkId: req.params.linkId,
      paid: paid,
      totalPaid: totalPaid,
      sessions: sessions.data.map(s => ({
        id: s.id,
        status: s.payment_status,
        amount: (s.amount_total || 0) / 100,
        customerEmail: s.customer_details?.email || "",
        createdAt: new Date(s.created * 1000).toISOString()
      }))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all tracked payment links
app.get("/api/stripe/links", authRequired, (req, res) => {
  const links = JSON.parse(getSetting("stripePaymentLinks") || "[]");
  res.json(links);
});

// Test Stripe connection
app.post("/api/stripe/test", authRequired, adminOnly, async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "API key required" });

  try {
    const testStripe = require("stripe")(apiKey);
    const account = await testStripe.accounts.retrieve();
    res.json({ success: true, businessName: account.business_profile?.name || account.settings?.dashboard?.display_name || "Connected", email: account.email || "" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Save Stripe API key
app.post("/api/stripe/configure", authRequired, adminOnly, (req, res) => {
  const { apiKey } = req.body;
  setSetting("stripeSecretKey", apiKey || "");
  res.json({ success: true });
});

// Get Stripe config status (doesn't return the key, just whether it's set)
app.get("/api/stripe/config-status", authRequired, (req, res) => {
  const key = getSetting("stripeSecretKey") || "";
  res.json({ configured: key.length > 0, keyHint: key ? `sk_...${key.slice(-6)}` : "" });
});

// ─── EMAIL ────────────────────────────────────────────────────────
app.post("/api/email/configure", authRequired, adminOnly, (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, fromName, fromEmail } = req.body;
  setSetting("smtpHost", smtpHost || "");
  setSetting("smtpPort", smtpPort || "587");
  setSetting("smtpUser", smtpUser || "");
  setSetting("smtpPass", smtpPass || "");
  setSetting("emailFromName", fromName || "Good Car Solutions");
  setSetting("emailFromEmail", fromEmail || "");
  res.json({ success: true });
});

app.get("/api/email/config-status", authRequired, (req, res) => {
  const host = getSetting("smtpHost") || "";
  const user = getSetting("smtpUser") || "";
  res.json({
    configured: host.length > 0 && user.length > 0,
    host: host,
    user: user ? `${user.slice(0, 3)}...` : "",
    fromName: getSetting("emailFromName") || "Good Car Solutions",
    fromEmail: getSetting("emailFromEmail") || ""
  });
});

app.post("/api/email/test", authRequired, adminOnly, async (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, testTo } = req.body;
  if (!smtpHost || !smtpUser || !testTo) return res.status(400).json({ error: "Host, user, and test email required" });
  try {
    const nodemailer = require("nodemailer");
    const transport = nodemailer.createTransport({
      host: smtpHost, port: parseInt(smtpPort) || 587, secure: parseInt(smtpPort) === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });
    await transport.sendMail({
      from: `"Good Car Solutions" <${smtpUser}>`,
      to: testTo,
      subject: "GCS Email Test",
      text: "This is a test email from Good Car Solutions. Email is configured correctly!",
      html: '<div style="font-family:sans-serif;padding:20px"><h2 style="color:#f97316">Good Car Solutions</h2><p>Email is configured correctly!</p></div>'
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/email/send-invoice", authRequired, async (req, res) => {
  const { to, customerName, invoiceNo, amount, paymentUrl, jobDescription } = req.body;
  if (!to) return res.status(400).json({ error: "Recipient email required" });

  const host = getSetting("smtpHost");
  const user = getSetting("smtpUser");
  const pass = getSetting("smtpPass");
  const port = getSetting("smtpPort") || "587";
  const fromName = getSetting("emailFromName") || "Good Car Solutions";
  const fromEmail = getSetting("emailFromEmail") || user;

  if (!host || !user) return res.status(400).json({ error: "Email not configured. Set up SMTP in Settings." });

  try {
    const nodemailer = require("nodemailer");
    const transport = nodemailer.createTransport({
      host, port: parseInt(port), secure: parseInt(port) === 465,
      auth: { user, pass }
    });

    const payButton = paymentUrl ?
      `<a href="${paymentUrl}" style="display:inline-block;background:#f97316;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;margin:20px 0">Pay $${Number(amount).toFixed(2)} Now</a>` :
      '';

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f8f9fa;padding:0">
        <div style="background:#111;padding:30px;text-align:center">
          <h1 style="color:#f97316;margin:0;font-size:24px">Good Car Solutions</h1>
          <p style="color:#888;margin:4px 0 0;font-size:12px">Vehicle Electrical & Programming Services</p>
        </div>
        <div style="padding:30px;background:white">
          <p style="font-size:16px;color:#333">Hi ${customerName || "Valued Customer"},</p>
          <p style="font-size:14px;color:#555;line-height:1.6">Your invoice <strong>#${invoiceNo}</strong> for <strong>$${Number(amount).toFixed(2)}</strong> is ready${jobDescription ? ` for: ${jobDescription}` : ""}.</p>
          ${payButton ? `<div style="text-align:center">${payButton}</div>` : ''}
          ${paymentUrl ? `<p style="font-size:12px;color:#888;text-align:center">Or copy this link: <a href="${paymentUrl}" style="color:#f97316">${paymentUrl}</a></p>` : ''}
          <p style="font-size:14px;color:#555;margin-top:24px">Thank you for your business!</p>
          <p style="font-size:14px;color:#333;font-weight:bold">Good Car Solutions</p>
        </div>
        <div style="padding:20px;text-align:center;background:#f1f1f1">
          <p style="font-size:11px;color:#999;margin:0">Good Car Solutions · Houston, TX</p>
        </div>
      </div>`;

    await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `Invoice #${invoiceNo}${jobDescription ? ' — '+jobDescription : ''} — $${Number(amount).toFixed(2)} — Good Car Solutions`,
      text: `Hi ${customerName || "Valued Customer"}, your invoice #${invoiceNo} for $${Number(amount).toFixed(2)} is ready.${paymentUrl ? ` Pay here: ${paymentUrl}` : ""} Thank you for your business! — Good Car Solutions`,
      html
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── INVOICES (Server-side) ──────────────────────────────────────
app.get("/api/invoices", authRequired, (req, res) => {
  try { res.json({ data: query("SELECT * FROM invoices ORDER BY created_at DESC") }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/invoices", authRequired, (req, res) => {
  try {
    const b = req.body;
    const id = "INV-" + Date.now().toString(36).toUpperCase();
    // Check if the job already has a locked invoice number
    let invoiceNo = b.invoice_no || b.invoiceNo || "";
    if (!invoiceNo && b.job_id) {
      const jobRows = query("SELECT invoice_no FROM jobs WHERE id = ?", [b.job_id]);
      if (jobRows.length && jobRows[0].invoice_no) {
        invoiceNo = jobRows[0].invoice_no;
      }
    }
    // Only assign a new number if job has never been invoiced
    if (!invoiceNo) {
      invoiceNo = getSetting("nextInvoiceNumber") || "1";
      const next = parseInt(invoiceNo) + 1;
      setSetting("nextInvoiceNumber", String(next));
    }
    // Lock the invoice number to the job so it never changes
    if (b.job_id) {
      run("UPDATE jobs SET invoice_no = ?, updated_at = ? WHERE id = ?",
        [String(invoiceNo), new Date().toISOString(), b.job_id]);
    }
    const lineItems = typeof b.line_items === "string" ? b.line_items : JSON.stringify(b.line_items || b.lineItems || []);
    run(`INSERT INTO invoices (id, invoice_no, job_id, bill_to, bill_to_phone, bill_to_email, vehicle, vin, line_items, subtotal, total, paid, payment_instructions, comments, notes, terms, date, due_date, payment_url, created_by, include_images, include_pdfs)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, invoiceNo, b.job_id||"", b.bill_to||b.billTo||"", b.bill_to_phone||b.billToPhone||"", b.bill_to_email||b.billToEmail||"",
       b.vehicle||"", b.vin||"", lineItems, b.subtotal||0, b.total||0, b.paid||0,
       b.payment_instructions||b.paymentInstructions||"All sales are final no return or exchanges. 60 day warranty on service only to the scope of the work.",
       b.comments||"", b.notes||"", b.terms||"NET 0",
       b.date||new Date().toISOString().split("T")[0], b.due_date||b.dueDate||b.date||new Date().toISOString().split("T")[0],
       b.payment_url||b.paymentUrl||"", req.user?.display_name||"",
       b.include_images||0, b.include_pdfs||0]);
    res.json({ data: { id, invoiceNo } });

    // Save line items back to the job so they persist
    if (b.job_id) {
      const liJson = typeof b.line_items === "string" ? b.line_items : JSON.stringify(b.line_items || b.lineItems || []);
      run("UPDATE jobs SET line_items = ?, amount = ?, updated_at = ? WHERE id = ?",
        [liJson, b.total || 0, new Date().toISOString(), b.job_id]);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public invoice page — no auth
app.get("/invoice/:id", (req, res) => {
  try {
    const rows = query("SELECT * FROM invoices WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).send("Invoice not found");
    const inv = rows[0];
    const companyName = getSetting("companyName") || "Good Car Solutions";
    // Gather images and PDFs from job timeline based on invoice settings
    let timelineImages = [];
    let timelinePdfs = [];
    if (inv.job_id) {
      const timeline = query("SELECT * FROM job_timeline WHERE job_id = ? ORDER BY timestamp ASC", [inv.job_id]);
      const imgExts = ["jpg","jpeg","png","gif","webp"];

      for (const t of timeline) {
        if (!t.file_json) continue;
        try {
          const f = JSON.parse(t.file_json);
          const ext = (f.extension || "").toLowerCase();
          if (imgExts.includes(ext) && inv.include_images) {
            const filePath = path.join(UPLOADS_DIR, f.storedName);
            if (fs.existsSync(filePath)) {
              const b64 = fs.readFileSync(filePath).toString("base64");
              const mimeMap = {jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp"};
              timelineImages.push({ base64: b64, mime: mimeMap[ext]||"image/jpeg", originalName: f.originalName, caption: t.text || "", date: t.timestamp });
            }
          } else if (ext === "pdf" && inv.include_pdfs) {
            timelinePdfs.push({ storedName: f.storedName, originalName: f.originalName, date: t.timestamp });
          }
        } catch(e) { console.error("Image processing error:", e.message); }
      }
    }
    res.setHeader("Content-Type", "text/html");
    res.send(buildInvoicePageHTML(inv, companyName, timelineImages, timelinePdfs));
  } catch (e) { res.status(500).send("Error loading invoice"); }
});

function buildInvoicePageHTML(inv, companyName, images, pdfs) {
  images = images || [];
  pdfs = pdfs || [];
  const lineItems = JSON.parse(inv.line_items || "[]");
  const balance = (inv.total || 0) - (inv.paid || 0);
  const isPaid = balance <= 0 && (inv.paid || 0) > 0;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice #${inv.invoice_no} — ${companyName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;color:#333;min-height:100vh}
.page{max-width:700px;margin:0 auto;background:#fff;min-height:100vh;padding:32px;position:relative}
@media print{body{background:#fff}.page{max-width:100%;padding:20px}.no-print{display:none!important}}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;flex-wrap:wrap;gap:16px}
.company{font-size:12px;color:#555;line-height:1.7}
.title{font-size:28px;font-weight:bold;margin-bottom:20px;color:#111}
.info-grid{display:flex;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px}
.bill-to .label{font-size:10px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px}
.bill-to .name{font-size:14px;font-weight:bold;color:#111}
.bill-to .sub{font-size:12px;color:#555}
.inv-table{font-size:12px;border-collapse:collapse}
.inv-table td{padding:3px 12px}
.inv-table .lbl{color:#888}
.vehicle-info{border-top:1px solid #ddd;padding-top:12px;margin-bottom:20px}
.vehicle-info td{padding:3px 20px 3px 0;font-size:12px}
.vehicle-info .lbl{color:#888;width:60px}
table.items{width:100%;border-collapse:collapse;margin-bottom:20px}
table.items th{padding:10px 12px;text-align:left;font-size:11px;font-weight:bold;border-top:2px solid #333;border-bottom:2px solid #333}
table.items th:nth-child(2){text-align:center}
table.items th:nth-child(3),table.items th:nth-child(4){text-align:right}
table.items td{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px}
table.items td:nth-child(2){text-align:center}
table.items td:nth-child(3),table.items td:nth-child(4){text-align:right}
.totals-row{display:flex;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:16px}
.pay-instructions{max-width:300px;font-size:12px}
.pay-instructions h4{font-size:13px;margin-bottom:6px}
.pay-instructions p{color:#555;line-height:1.5;font-size:11px;white-space:pre-wrap}
.totals{min-width:220px}
.totals table{font-size:12px;border-collapse:collapse;width:100%}
.totals td{padding:6px 16px}
.totals .lbl{color:#888}
.totals .val{text-align:right}
.totals .balance td{font-size:14px;font-weight:bold;border-top:1px solid #ddd;padding-top:8px}
.paid-stamp{display:inline-block;border:3px solid #cc0000;border-radius:6px;padding:4px 20px;margin-top:14px}
.paid-stamp span{font-size:22px;font-weight:bold;color:#cc0000}
.pay-btn{display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;margin:20px 0;text-align:center}
.comments{margin-top:16px}
.comments h4{font-size:13px;font-weight:bold;margin-bottom:6px}
.comments p{font-size:11px;color:#555;line-height:1.5;white-space:pre-wrap}
.actions{position:sticky;bottom:0;background:#fff;border-top:1px solid #eee;padding:16px;text-align:center;display:flex;gap:12px;justify-content:center}
.actions button,.actions a{padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;border:none}
.btn-print{background:#333;color:#fff}
.btn-pay{background:#f97316;color:#fff}
.footer{text-align:center;font-size:10px;color:#999;margin-top:40px;padding:20px 0;border-top:1px solid #eee}
</style></head>
<body>
<div class="page">
  <div class="header">
    <div class="company">
      <div style="font-size:18px;font-weight:bold;color:#f97316;margin-bottom:4px">${companyName}</div>
      <div>Mobile Service</div>
      <div>Goodcarsolutionstx@gmail.com</div>
      <div>GoodCarSolutionstx.com</div>
      <div>(979) 288-7747 · (832) 951-3325</div>
    </div>
  </div>

  <div class="title">Invoice</div>

  <div class="info-grid">
    <div class="bill-to">
      <div class="label">Bill To</div>
      <div class="name">${inv.bill_to||'—'}</div>
      <div class="sub">${inv.bill_to_phone||''}</div>
    </div>
    <div>
      <table class="inv-table">
        <tr><td class="lbl">Invoice No:</td><td><strong>${inv.invoice_no}</strong></td></tr>
        <tr><td class="lbl">Date:</td><td>${inv.date||''}</td></tr>
        <tr><td class="lbl">Terms:</td><td>${inv.terms||'NET 0'}</td></tr>
        <tr><td class="lbl">Due Date:</td><td>${inv.due_date||inv.date||''}</td></tr>
      </table>
    </div>
  </div>

  <div class="vehicle-info">
    <table><tr><td class="lbl">Vehicle</td><td>${inv.vehicle||''}</td></tr>
    ${inv.vin?`<tr><td class="lbl">VIN</td><td style="font-family:monospace">${inv.vin}</td></tr>`:''}</table>
  </div>

  <table class="items">
    <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>${lineItems.map(li=>`<tr><td>${li.description||''}</td><td>${li.quantity||1}</td><td>$${Number(li.rate||0).toFixed(2)}</td><td>$${Number(li.amount||0).toFixed(2)}</td></tr>`).join('')}</tbody>
  </table>

  <div class="totals-row">
    <div class="pay-instructions">
      <h4>Payment Instructions</h4>
      <p>${(inv.payment_instructions||'').replace(/</g,'&lt;')}</p>
      ${isPaid?'<div class="paid-stamp"><span>Paid</span></div>':''}
    </div>
    <div class="totals">
      <table>
        <tr><td class="lbl">Subtotal</td><td class="val">$${Number(inv.subtotal||0).toFixed(2)}</td></tr>
        <tr><td class="lbl">Total</td><td class="val"><strong>$${Number(inv.total||0).toFixed(2)}</strong></td></tr>
        <tr><td class="lbl">Paid</td><td class="val">$${Number(inv.paid||0).toFixed(2)}</td></tr>
        <tr class="balance"><td style="color:${isPaid?'#008800':'#cc0000'}">Balance Due</td><td class="val" style="color:${isPaid?'#008800':'#cc0000'}">$${Math.max(0,balance).toFixed(2)}</td></tr>
      </table>
    </div>
  </div>

  ${inv.payment_url&&!isPaid?`<div style="text-align:center;margin:20px 0"><a href="${inv.payment_url}" class="btn-pay">Pay $${Math.max(0,balance).toFixed(2)} Now</a></div>`:''}

  ${inv.comments?`<div class="comments"><h4>Comments</h4><p>${inv.comments.replace(/</g,'&lt;')}</p></div>`:''}
  ${inv.notes?`<div class="comments"><h4>Work Notes</h4><p>${inv.notes.replace(/</g,'&lt;')}</p></div>`:''}

  ${images.length>0?`
  <div style="margin-top:24px;page-break-inside:avoid">
    <h4 style="font-size:14px;margin-bottom:12px;border-bottom:1px solid #ddd;padding-bottom:6px">Photos</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
      ${images.map(img=>`<div style="border:1px solid #eee;border-radius:8px;overflow:hidden">
        <img src="data:${img.mime};base64,${img.base64}" style="width:100%;height:auto;display:block;image-orientation:from-image" alt="${(img.originalName||'').replace(/"/g,'&quot;')}">
        ${img.caption&&!img.caption.startsWith('Attached:')?`<div style="padding:6px 8px;font-size:11px;color:#555">${img.caption.replace(/</g,'&lt;')}</div>`:''}
      </div>`).join('')}
    </div>
  </div>`:''}

  ${pdfs.length>0?`
  <div style="margin-top:16px">
    <h4 style="font-size:14px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:6px">Attached Documents</h4>
    ${pdfs.map(p=>`<div style="padding:8px 0;border-bottom:1px solid #f0f0f0">
      <a href="/api/files/${p.storedName}" target="_blank" style="color:#f97316;text-decoration:none;font-size:13px">📄 ${p.originalName}</a>
    </div>`).join('')}
  </div>`:''}
  <div class="footer">${companyName} · Invoice #${inv.invoice_no} · ${inv.date||''}</div>
</div>

<div class="actions no-print">
  <button class="btn-print" onclick="window.print()">🖨 Print / Save PDF</button>
  ${inv.payment_url&&!isPaid?`<a href="${inv.payment_url}" class="btn-pay">Pay Now</a>`:''}
</div>
</body></html>`;
}

// ─── ESTIMATES ───────────────────────────────────────────────────
app.get("/api/estimates", authRequired, (req, res) => {
  try {
    const rows = query("SELECT * FROM estimates ORDER BY created_at DESC");
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/estimates", authRequired, (req, res) => {
  try {
    const b = req.body;
    const id = "EST-" + Date.now().toString(36).toUpperCase();
    run(`INSERT INTO estimates (id, caller_name, phone, email, vehicle_year, vehicle_make, vehicle_model, vin, service_type, modules, description, price, status, notes, created_by, customer_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.caller_name||"", b.phone||"", b.email||"", b.vehicle_year||"", b.vehicle_make||"", b.vehicle_model||"", b.vin||"",
       b.service_type||"ECU Programming", b.modules||"", b.description||"", b.price||0, "New", b.notes||"", req.user?.display_name||"", b.customer_id||""]);
    res.json({ data: { id, ...b, status: "New", created_at: new Date().toISOString() } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/estimates/:id", authRequired, (req, res) => {
  try {
    const b = req.body;
    const fields = [];
    const vals = [];
    for (const [k, v] of Object.entries(b)) {
      const col = k.replace(/([A-Z])/g, "_$1").toLowerCase();
      fields.push(`${col} = ?`);
      vals.push(v);
    }
    fields.push("updated_at = datetime('now')");
    vals.push(req.params.id);
    run(`UPDATE estimates SET ${fields.join(", ")} WHERE id = ?`, vals);
    res.json({ data: { id: req.params.id, ...b } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/estimates/:id", authRequired, adminOnly, (req, res) => {
  try {
    run("DELETE FROM estimates WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Convert estimate to work order
app.post("/api/estimates/:id/convert", authRequired, (req, res) => {
  try {
    const est = query("SELECT * FROM estimates WHERE id = ?", [req.params.id]);
    if (!est.length) return res.status(404).json({ error: "Estimate not found" });
    const e = est[0];
    // Get next job number
    let nextNum = parseInt(getSetting("nextJobNumber") || "1");
    const prefix = getSetting("defaultJobPrefix") || "GCS";
    const jobId = `${prefix}-${String(nextNum).padStart(4, "0")}`;
    setSetting("nextJobNumber", String(nextNum + 1));

    const vehicle = [e.vehicle_year, e.vehicle_make, e.vehicle_model].filter(Boolean).join(" ");
    const custId = e.customer_id || "";
    const custName = e.caller_name || "";
    // If estimate has a linked customer, use their name and address
    let serviceAddr = "";
    if (custId) {
      const custRows = query("SELECT * FROM customers WHERE id = ?", [custId]);
      if (custRows.length) {
        serviceAddr = custRows[0].address || "";
      }
    }
    run(`INSERT INTO jobs (id, vehicle, vin, customer, customer_id, type, ecu, status, amount, date, service_address, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      [jobId, vehicle, e.vin||"", custName, custId, e.service_type||"ECU Programming", e.modules||"", "Scheduled", e.price||0, new Date().toISOString().split("T")[0], serviceAddr]);
    // Add initial timeline note
    if (e.description || e.notes) {
      run(`INSERT INTO job_timeline (job_id, type, text, created_by) VALUES (?,?,?,?)`,
        [jobId, "note", `Converted from estimate ${e.id}\n${e.description||""}\n${e.notes||""}`.trim(), req.user?.display_name||""]);
    }
    // Mark estimate as converted
    run("UPDATE estimates SET status = 'Converted', converted_job_id = ?, updated_at = datetime('now') WHERE id = ?", [jobId, req.params.id]);
    res.json({ data: { estimateId: req.params.id, jobId } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── AGREEMENTS / COMPLIANCE ─────────────────────────────────────
app.get("/api/agreements", authRequired, (req, res) => {
  try {
    const rows = query("SELECT * FROM agreements ORDER BY created_at DESC");
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/agreements", authRequired, (req, res) => {
  try {
    const b = req.body;
    const id = "AGR-" + Date.now().toString(36).toUpperCase();
    run(`INSERT INTO agreements (id, job_id, estimate_id, customer_name, customer_email, vehicle, scope_of_work, amount)
         VALUES (?,?,?,?,?,?,?,?)`,
      [id, b.job_id||"", b.estimate_id||"", b.customer_name||"", b.customer_email||"", b.vehicle||"", b.scope_of_work||"", b.amount||0]);
    res.json({ data: { id, ...b, created_at: new Date().toISOString() } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public agreement page — no auth required
app.get("/agreement/:id", (req, res) => {
  try {
    const rows = query("SELECT * FROM agreements WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).send("Agreement not found");
    const a = rows[0];
    const companyName = getSetting("companyName") || "Good Car Solutions";
    const signed = !!a.signed_at;
    res.setHeader("Content-Type", "text/html");
    res.send(buildAgreementHTML(a, companyName, signed));
  } catch (e) { res.status(500).send("Error loading agreement"); }
});

// Public signature submission — no auth
app.post("/agreement/:id/sign", express.json(), (req, res) => {
  try {
    const rows = query("SELECT * FROM agreements WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Agreement not found" });
    if (rows[0].signed_at) return res.status(400).json({ error: "Already signed" });
    run("UPDATE agreements SET signature_data = ?, signed_at = datetime('now') WHERE id = ?",
      [req.body.signature || "", req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function buildAgreementHTML(a, companyName, signed) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Service Agreement — ${companyName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0e13;color:#e2e8f0;min-height:100vh;padding:20px}
.container{max-width:700px;margin:0 auto}
.header{text-align:center;padding:30px 0;border-bottom:2px solid #f97316}
.header h1{color:#f97316;font-size:24px;margin-bottom:4px}
.header .sub{color:#64748b;font-size:13px}
.section{padding:24px 0;border-bottom:1px solid #1e2a35}
.section h2{color:#f97316;font-size:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px}
.section p,.section li{font-size:14px;line-height:1.8;color:#cbd5e1}
.section ul{padding-left:24px}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.detail{background:#111820;border:1px solid #1e2a35;border-radius:8px;padding:12px}
.detail .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
.detail .value{font-size:15px;color:#e2e8f0;font-weight:600}
.sig-area{background:#111820;border:2px dashed #1e2a35;border-radius:12px;padding:20px;text-align:center;margin-top:20px}
canvas{border:1px solid #2a3a4a;border-radius:8px;background:#0a0e13;cursor:crosshair;touch-action:none;max-width:100%}
.btn{display:inline-block;padding:14px 32px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}
.btn-primary{background:#f97316;color:#fff}
.btn-secondary{background:#1e2a35;color:#94a3b8}
.btn:disabled{opacity:0.4;cursor:not-allowed}
.signed-badge{display:inline-flex;align-items:center;gap:8px;background:#1a3a2a;color:#4ade80;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600}
.sig-img{max-width:300px;border:1px solid #1e2a35;border-radius:4px}
</style></head>
<body><div class="container">
  <div class="header">
    <h1>${companyName}</h1>
    <div class="sub">Service Agreement & Limited Warranty</div>
  </div>

  <div class="section">
    <h2>Service Details</h2>
    <div class="detail-grid">
      <div class="detail"><div class="label">Client</div><div class="value">${a.customer_name||'—'}</div></div>
      <div class="detail"><div class="label">Vehicle</div><div class="value">${a.vehicle||'—'}</div></div>
      <div class="detail"><div class="label">Agreement #</div><div class="value">${a.id}</div></div>
      <div class="detail"><div class="label">Amount</div><div class="value">$${Number(a.amount||0).toLocaleString()}</div></div>
    </div>
    ${a.scope_of_work?`<div style="margin-top:16px"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Scope of Work</div><p style="background:#111820;border:1px solid #1e2a35;border-radius:8px;padding:14px;font-size:13px;white-space:pre-wrap">${a.scope_of_work}</p></div>`:''}
  </div>

  <div class="section">
    <h2>Terms of Service</h2>
    <p>By signing this agreement, the Client acknowledges and agrees to the following terms governing all automotive electrical and ECU programming services performed by ${companyName}:</p>
  </div>

  <div class="section">
    <h2>1. Scope-Based Responsibility</h2>
    <p>${companyName} assumes responsibility <strong>only for the specific modules, ECUs, and systems directly touched or programmed</strong> during the agreed-upon scope of work. We do not assume responsibility for the overall condition of the vehicle, pre-existing issues, or systems not included in the scope of work.</p>
  </div>

  <div class="section">
    <h2>2. Nature of Programming Services</h2>
    <p>Automotive ECU programming, calibration, and electrical modification are inherently complex processes. The Client acknowledges that:</p>
    <ul>
      <li>Programming processes may reveal or trigger pre-existing latent issues in vehicle electronics</li>
      <li>Module communication, firmware, and calibration changes can have downstream effects on interconnected systems</li>
      <li>Results depend on the condition of existing vehicle hardware and wiring</li>
      <li>Not all outcomes can be guaranteed due to the variable nature of vehicle electronics</li>
    </ul>
  </div>

  <div class="section">
    <h2>3. Limited Warranty — "If We Break It, We Pay" Policy</h2>
    <p>${companyName} provides a <strong>limited warranty</strong> covering:</p>
    <ul>
      <li><strong>Direct damage</strong> to modules or components caused by our tools, processes, or technician error during the scope of work</li>
      <li><strong>Replacement or repair</strong> of any component we directly damage, at our discretion</li>
      <li>${companyName} reserves the right to choose the remedy: repair, replacement, refund, or alternative solution as we see fit</li>
    </ul>
    <p style="margin-top:12px">This warranty <strong>does not cover</strong>:</p>
    <ul>
      <li>Pre-existing conditions, wear, or latent defects in the vehicle</li>
      <li>Issues with modules or systems not included in the scope of work</li>
      <li>Indirect, consequential, or incidental damages</li>
      <li>Damage caused by third-party modifications or subsequent service by others</li>
      <li>Loss of use, revenue, or any perpetual/ongoing financial loss</li>
    </ul>
  </div>

  <div class="section">
    <h2>4. Insurance & Liability Cap</h2>
    <p>${companyName} carries professional liability insurance. In the unlikely event of a covered incident, we reserve the right to resolve claims through any option we deem appropriate, including but not limited to direct repair, replacement, insurance claim, or negotiated settlement. <strong>Total liability shall not exceed the service amount stated in this agreement.</strong></p>
  </div>

  <div class="section">
    <h2>5. No Perpetual Obligation</h2>
    <p>This agreement does not create any ongoing, perpetual, or open-ended obligation. Services are provided on a per-job basis. Warranty coverage is limited to the specific work performed and a reasonable timeframe following service completion (30 days unless otherwise stated).</p>
  </div>

  <div class="section">
    <h2>6. Mutual Good Faith</h2>
    <p>${companyName} is committed to providing the highest quality workmanship and will assist with every repair to the best of our ability. We strive to find fair solutions for all parties. This agreement is designed to allow us to compete on pricing while also ensuring fair compensation for our expertise and time.</p>
  </div>

  <div class="section" style="border-bottom:none">
    <h2>Client Acknowledgment & Signature</h2>
    <p>By signing below, the Client confirms they have read, understood, and agree to all terms outlined in this Service Agreement & Limited Warranty.</p>
    ${signed ? `
      <div style="margin-top:20px;text-align:center">
        <div class="signed-badge">✓ Signed on ${a.signed_at ? new Date(a.signed_at).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"}) : ""}</div>
        ${a.signature_data ? `<div style="margin-top:16px"><img src="${a.signature_data}" class="sig-img" alt="Signature"/></div>` : ""}
      </div>
    ` : `
      <div class="sig-area" id="sigArea">
        <p style="font-size:12px;color:#64748b;margin-bottom:12px">Draw your signature below</p>
        <canvas id="sigCanvas" width="500" height="150"></canvas>
        <div style="margin-top:12px;display:flex;gap:12px;justify-content:center">
          <button class="btn btn-secondary" onclick="clearSig()">Clear</button>
          <button class="btn btn-primary" id="signBtn" onclick="submitSignature()">Sign & Accept</button>
        </div>
      </div>
      <script>
        const c=document.getElementById('sigCanvas');
        const ctx=c.getContext('2d');
        let drawing=false;let hasDrawn=false;
        ctx.strokeStyle='#e2e8f0';ctx.lineWidth=2;ctx.lineCap='round';

        function getPos(e){
          const r=c.getBoundingClientRect();
          const t=e.touches?e.touches[0]:e;
          return{x:t.clientX-r.left,y:t.clientY-r.top};
        }
        c.addEventListener('mousedown',e=>{drawing=true;const p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
        c.addEventListener('mousemove',e=>{if(!drawing)return;hasDrawn=true;const p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();});
        c.addEventListener('mouseup',()=>{drawing=false;});
        c.addEventListener('touchstart',e=>{e.preventDefault();drawing=true;const p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});
        c.addEventListener('touchmove',e=>{e.preventDefault();if(!drawing)return;hasDrawn=true;const p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();},{passive:false});
        c.addEventListener('touchend',()=>{drawing=false;});

        function clearSig(){ctx.clearRect(0,0,c.width,c.height);hasDrawn=false;}

        async function submitSignature(){
          if(!hasDrawn){alert('Please sign above first');return;}
          const btn=document.getElementById('signBtn');
          btn.disabled=true;btn.textContent='Submitting...';
          try{
            const r=await fetch(window.location.pathname+'/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:c.toDataURL()})});
            const d=await r.json();
            if(d.success){window.location.reload();}
            else{alert(d.error||'Error signing');btn.disabled=false;btn.textContent='Sign & Accept';}
          }catch(e){alert('Error: '+e.message);btn.disabled=false;btn.textContent='Sign & Accept';}
        }
      </script>
    `}
  </div>

  <div style="text-align:center;padding:30px 0;color:#334155;font-size:11px">
    ${companyName} · Service Agreement · ${a.id}<br/>Generated ${new Date(a.created_at).toLocaleDateString("en-US")}
  </div>
</div></body></html>`;
}

// ─── MIGRATION: Add missing columns to jobs ─────────────────────
async function migrateSchema() {
  // query() catches errors and returns [], so we must check columns via PRAGMA
  const cols = query("PRAGMA table_info(jobs)");
  const colNames = cols.map(c => c.name);
  
  if (!colNames.includes("team_id")) {
    try { run("ALTER TABLE jobs ADD COLUMN team_id TEXT DEFAULT ''"); console.log("  [MIGRATE] Added team_id to jobs"); } catch(e) { console.log("  [MIGRATE] team_id already exists or error:", e.message); }
  }
  if (!colNames.includes("scheduled_start")) {
    try { run("ALTER TABLE jobs ADD COLUMN scheduled_start TEXT DEFAULT ''"); console.log("  [MIGRATE] Added scheduled_start to jobs"); } catch(e) { console.log("  [MIGRATE] scheduled_start error:", e.message); }
  }
  if (!colNames.includes("scheduled_end")) {
    try { run("ALTER TABLE jobs ADD COLUMN scheduled_end TEXT DEFAULT ''"); console.log("  [MIGRATE] Added scheduled_end to jobs"); } catch(e) { console.log("  [MIGRATE] scheduled_end error:", e.message); }
  }
  if (!colNames.includes("line_items")) {
    try { run("ALTER TABLE jobs ADD COLUMN line_items TEXT DEFAULT '[]'"); console.log("  [MIGRATE] Added line_items to jobs"); } catch(e) { console.log("  [MIGRATE] line_items error:", e.message); }
  }
  if (!colNames.includes("invoice_draft")) {
    try { run("ALTER TABLE jobs ADD COLUMN invoice_draft TEXT DEFAULT ''"); console.log("  [MIGRATE] Added invoice_draft to jobs"); } catch(e) { console.log("  [MIGRATE] invoice_draft error:", e.message); }
  }
  if (!colNames.includes("invoice_no")) {
    try { run("ALTER TABLE jobs ADD COLUMN invoice_no TEXT DEFAULT ''"); console.log("  [MIGRATE] Added invoice_no to jobs"); } catch(e) {}
  }

  // Invoices table migrations
  const invCols = query("PRAGMA table_info(invoices)").map(c => c.name);
  if (!invCols.includes("include_images")) {
    try { run("ALTER TABLE invoices ADD COLUMN include_images INTEGER DEFAULT 0"); console.log("  [MIGRATE] Added include_images to invoices"); } catch(e) {}
  }
  if (!invCols.includes("include_pdfs")) {
    try { run("ALTER TABLE invoices ADD COLUMN include_pdfs INTEGER DEFAULT 0"); console.log("  [MIGRATE] Added include_pdfs to invoices"); } catch(e) {}
  }

  // Estimates table migrations
  const estCols = query("PRAGMA table_info(estimates)").map(c => c.name);
  if (!estCols.includes("customer_id")) {
    try { run("ALTER TABLE estimates ADD COLUMN customer_id TEXT DEFAULT ''"); console.log("  [MIGRATE] Added customer_id to estimates"); } catch(e) {}
  }
}

// ─── TEAMS ──────────────────────────────────────────────────────
app.get("/api/teams", authRequired, (req, res) => {
  try {
    const teams = query("SELECT * FROM teams ORDER BY name ASC");
    teams.forEach(t => {
      t.members = query("SELECT tm.*, u.username, u.display_name, u.role as user_role FROM team_members tm JOIN users u ON tm.user_id = u.id WHERE tm.team_id = ?", [t.id]);
      t.jobs = query("SELECT * FROM jobs WHERE team_id = ? ORDER BY updated_at DESC", [t.id]).map(j => ({
        id:j.id, vehicle:j.vehicle, vin:j.vin, customer:j.customer, customerId:j.customer_id,
        type:j.type, status:j.status, date:j.date, serviceAddress:j.service_address,
        scheduledStart:j.scheduled_start||"", scheduledEnd:j.scheduled_end||"", teamId:j.team_id||""
      }));
    });
    res.json({ data: teams });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/teams", authRequired, (req, res) => {
  try {
    const { name, color, description } = req.body;
    if (!name) return res.status(400).json({ error: "Team name required" });
    const id = "TEAM-" + Date.now().toString(36).toUpperCase();
    run("INSERT INTO teams (id, name, color, description) VALUES (?,?,?,?)", [id, name, color || "#f97316", description || ""]);
    res.json({ data: { id, name, color, description } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/teams/:id", authRequired, (req, res) => {
  try {
    const u = req.body;
    for (const key of ["name", "color", "description"]) {
      if (u[key] !== undefined) run(`UPDATE teams SET ${key} = ? WHERE id = ?`, [u[key], req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/teams/:id", authRequired, adminOnly, (req, res) => {
  try {
    run("DELETE FROM team_members WHERE team_id = ?", [req.params.id]);
    run("UPDATE jobs SET team_id = '' WHERE team_id = ?", [req.params.id]);
    run("DELETE FROM teams WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/teams/:id/members", authRequired, (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id required" });
    run("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?,?)", [req.params.id, user_id]);
    // Notify user
    const team = query("SELECT name FROM teams WHERE id = ?", [req.params.id]);
    if (team.length) {
      run("INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)",
        [user_id, "team", "Added to team", `You were added to team "${team[0].name}"`]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/teams/:id/members/:userId", authRequired, (req, res) => {
  try {
    run("DELETE FROM team_members WHERE team_id = ? AND user_id = ?", [req.params.id, req.params.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assign job to team
app.post("/api/teams/:id/assign-job", authRequired, (req, res) => {
  try {
    const { job_id } = req.body;
    if (!job_id) return res.status(400).json({ error: "job_id required" });
    run("UPDATE jobs SET team_id = ? WHERE id = ?", [req.params.id, job_id]);
    // Notify all team members
    const members = query("SELECT user_id FROM team_members WHERE team_id = ?", [req.params.id]);
    const team = query("SELECT name FROM teams WHERE id = ?", [req.params.id]);
    const job = query("SELECT vehicle, customer FROM jobs WHERE id = ?", [job_id]);
    const teamName = team.length ? team[0].name : "team";
    const jobDesc = job.length ? `${job[0].vehicle} — ${job[0].customer}` : job_id;
    members.forEach(m => {
      run("INSERT INTO notifications (user_id, type, title, message, link) VALUES (?,?,?,?,?)",
        [m.user_id, "assignment", "New job assigned", `"${jobDesc}" assigned to ${teamName}`, job_id]);
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/teams/:id/unassign-job", authRequired, (req, res) => {
  try {
    const { job_id } = req.body;
    run("UPDATE jobs SET team_id = '' WHERE id = ? AND team_id = ?", [job_id, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── APPOINTMENTS ───────────────────────────────────────────────
app.get("/api/appointments", authRequired, (req, res) => {
  try {
    const { date, from, to } = req.query;
    let sql = "SELECT * FROM appointments";
    let params = [];
    if (date) { sql += " WHERE date = ?"; params.push(date); }
    else if (from && to) { sql += " WHERE date >= ? AND date <= ?"; params.push(from, to); }
    sql += " ORDER BY date ASC, time_start ASC";
    res.json({ data: query(sql, params.length ? params : undefined) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/appointments", authRequired, (req, res) => {
  try {
    const b = req.body;
    if (!b.date) return res.status(400).json({ error: "Date required" });
    const id = "APT-" + Date.now().toString(36).toUpperCase();
    run(`INSERT INTO appointments (id, job_id, title, customer, vehicle, service_address, date, time_start, time_end, team_id, assigned_to, status, notes, lat, lng, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.job_id||"", b.title||"", b.customer||"", b.vehicle||"", b.service_address||b.serviceAddress||"",
       b.date, b.time_start||b.timeStart||"09:00", b.time_end||b.timeEnd||"10:00",
       b.team_id||b.teamId||"", b.assigned_to||b.assignedTo||"", b.status||"Scheduled",
       b.notes||"", b.lat||0, b.lng||0, req.user?.display_name||""]);
    // Notify assigned team
    if (b.team_id || b.teamId) {
      const tid = b.team_id || b.teamId;
      const members = query("SELECT user_id FROM team_members WHERE team_id = ?", [tid]);
      members.forEach(m => {
        run("INSERT INTO notifications (user_id, type, title, message, link) VALUES (?,?,?,?,?)",
          [m.user_id, "appointment", "New appointment", `${b.title||b.customer||"Appointment"} on ${b.date} at ${b.time_start||"09:00"}`, id]);
      });
    }
    res.json({ data: { id } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/appointments/:id", authRequired, (req, res) => {
  try {
    const u = req.body;
    const fields = ["job_id","title","customer","vehicle","service_address","date","time_start","time_end","team_id","assigned_to","status","notes","lat","lng"];
    for (const key of fields) {
      if (u[key] !== undefined) run(`UPDATE appointments SET ${key} = ? WHERE id = ?`, [u[key], req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/appointments/:id", authRequired, (req, res) => {
  try {
    run("DELETE FROM appointments WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── NOTIFICATIONS ──────────────────────────────────────────────
app.get("/api/notifications", authRequired, (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.json({ data: [] });
    const notifs = query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]);
    const unread = query("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0", [userId]);
    res.json({ data: notifs, unread: unread[0]?.c || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/notifications/read", authRequired, (req, res) => {
  try {
    const userId = req.user?.id;
    if (req.body.id) {
      run("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", [req.body.id, userId]);
    } else {
      run("UPDATE notifications SET read = 1 WHERE user_id = ?", [userId]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/notifications/clear", authRequired, (req, res) => {
  try {
    run("DELETE FROM notifications WHERE user_id = ?", [req.user?.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PUBLIC INTAKE FORM ─────────────────────────────────────────
app.get("/intake", (req, res) => {
  const companyName = getSetting("companyName") || "Good Car Solutions";
  res.setHeader("Content-Type", "text/html");
  res.send(buildIntakeFormHTML(companyName));
});

app.post("/api/intake", (req, res) => {
  try {
    const b = req.body;
    if (!b.customer_name && !b.phone) return res.status(400).json({ error: "Name or phone required" });
    const id = "INT-" + Date.now().toString(36).toUpperCase();
    run(`INSERT INTO intake_submissions (id, customer_name, phone, email, vehicle_year, vehicle_make, vehicle_model, vin, service_type, description, preferred_date, preferred_time, service_address)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.customer_name||"", b.phone||"", b.email||"", b.vehicle_year||"", b.vehicle_make||"",
       b.vehicle_model||"", b.vin||"", b.service_type||"", b.description||"",
       b.preferred_date||"", b.preferred_time||"", b.service_address||""]);
    // Notify all admins
    const admins = query("SELECT id FROM users WHERE role = 'admin' AND active = 1");
    admins.forEach(a => {
      run("INSERT INTO notifications (user_id, type, title, message, link) VALUES (?,?,?,?,?)",
        [a.id, "intake", "New intake submission", `${b.customer_name||"Client"} — ${b.vehicle_year||""} ${b.vehicle_make||""} ${b.vehicle_model||""}`, id]);
    });
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/intake-submissions", authRequired, (req, res) => {
  try { res.json({ data: query("SELECT * FROM intake_submissions ORDER BY created_at DESC") }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/intake-submissions/:id", authRequired, (req, res) => {
  try {
    const u = req.body;
    if (u.status) run("UPDATE intake_submissions SET status = ? WHERE id = ?", [u.status, req.params.id]);
    if (u.converted_estimate_id) run("UPDATE intake_submissions SET converted_estimate_id = ?, status = 'Converted' WHERE id = ?", [u.converted_estimate_id, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/intake-submissions/:id", authRequired, (req, res) => {
  try { run("DELETE FROM intake_submissions WHERE id = ?", [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

function buildIntakeFormHTML(companyName) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Service Request — ${companyName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#070a0e;color:#e2e8f0;min-height:100vh}
.page{max-width:600px;margin:0 auto;padding:24px}
.header{text-align:center;padding:32px 0}
.header h1{font-size:24px;color:#f97316;margin-bottom:4px}
.header p{font-size:13px;color:#64748b}
.card{background:#0c1117;border:1px solid #1e2a35;border-radius:12px;padding:20px;margin-bottom:16px}
.section-title{font-size:13px;color:#64748b;font-weight:600;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px}
label{display:block;font-size:12px;color:#94a3b8;margin-bottom:6px}
input,select,textarea{width:100%;padding:12px;font-size:15px;background:#111820;border:1px solid #1e2a35;border-radius:8px;color:#e2e8f0;font-family:inherit;outline:none}
input:focus,select:focus,textarea:focus{border-color:#f97316}
select{appearance:auto}
textarea{resize:vertical;min-height:80px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.field{margin-bottom:12px}
.required::after{content:" *";color:#f87171}
.btn{display:block;width:100%;padding:16px;font-size:16px;font-weight:700;background:#f97316;color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit}
.btn:hover{background:#ea580c}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.success{text-align:center;padding:60px 20px}
.success h2{color:#4ade80;font-size:24px;margin-bottom:8px}
.success p{color:#94a3b8;font-size:14px;line-height:1.6}
.footer{text-align:center;padding:24px;font-size:11px;color:#334155}
@media(max-width:500px){.row,.row3{grid-template-columns:1fr}}
</style></head>
<body>
<div class="page">
  <div class="header">
    <h1>${companyName}</h1>
    <p>Vehicle Electrical & Programming Services</p>
  </div>

  <div id="form">
    <div class="card">
      <div class="section-title">Your Information</div>
      <div class="field"><label class="required">Name</label><input id="f_name" placeholder="Your name or business name"></div>
      <div class="row">
        <div class="field"><label class="required">Phone</label><input id="f_phone" type="tel" placeholder="(xxx) xxx-xxxx"></div>
        <div class="field"><label>Email</label><input id="f_email" type="email" placeholder="email@..."></div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Vehicle Information</div>
      <div class="row3">
        <div class="field"><label>Year</label><input id="f_year" placeholder="2024" type="number"></div>
        <div class="field"><label>Make</label><input id="f_make" placeholder="Ford, Chevy..."></div>
        <div class="field"><label>Model</label><input id="f_model" placeholder="F-150, Camaro..."></div>
      </div>
      <div class="field"><label>VIN (if known)</label><input id="f_vin" placeholder="17-character VIN" maxlength="17" style="text-transform:uppercase;font-family:monospace"></div>
    </div>

    <div class="card">
      <div class="section-title">Service Needed</div>
      <div class="field"><label>Service Type</label>
        <select id="f_type">
          <option value="">Select a service...</option>
          <option>ECU Programming</option>
          <option>ECU Tuning</option>
          <option>Key Programming</option>
          <option>Module Coding</option>
          <option>DTC Delete</option>
          <option>Immobilizer Bypass</option>
          <option>BCM Programming</option>
          <option>Electrical Diagnostics</option>
          <option>Other</option>
        </select>
      </div>
      <div class="field"><label>Describe what you need</label><textarea id="f_desc" placeholder="Tell us about the issue or service you need..." rows="3"></textarea></div>
    </div>

    <div class="card">
      <div class="section-title">Scheduling Preference</div>
      <div class="row">
        <div class="field"><label>Preferred Date</label><input id="f_date" type="date"></div>
        <div class="field"><label>Preferred Time</label>
          <select id="f_time">
            <option value="">Flexible</option>
            <option>Morning (8am-12pm)</option>
            <option>Afternoon (12pm-5pm)</option>
            <option>Evening (5pm-8pm)</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Service Address (we come to you)</label><input id="f_address" placeholder="Street address, city, state"></div>
    </div>

    <button class="btn" id="submitBtn" onclick="submitForm()">Submit Service Request</button>
    <div id="errorMsg" style="text-align:center;color:#f87171;margin-top:12px;font-size:13px;display:none"></div>
  </div>

  <div id="success" style="display:none">
    <div class="success">
      <div style="font-size:64px;margin-bottom:16px">✅</div>
      <h2>Request Submitted!</h2>
      <p>Thank you! We've received your service request and will get back to you shortly with a quote.</p>
      <p style="margin-top:16px;color:#64748b;font-size:12px">If you need immediate assistance, call us at<br/><a href="tel:9792887747" style="color:#f97316;text-decoration:none">(979) 288-7747</a> or <a href="tel:8329513325" style="color:#f97316;text-decoration:none">(832) 951-3325</a></p>
    </div>
  </div>

  <div class="footer">${companyName} · Houston, TX · Mobile Service</div>
</div>

<script>
async function submitForm(){
  const name=document.getElementById('f_name').value.trim();
  const phone=document.getElementById('f_phone').value.trim();
  if(!name&&!phone){document.getElementById('errorMsg').textContent='Please enter your name or phone number';document.getElementById('errorMsg').style.display='block';return;}
  const btn=document.getElementById('submitBtn');
  btn.disabled=true;btn.textContent='Submitting...';
  document.getElementById('errorMsg').style.display='none';
  try{
    const r=await fetch('/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      customer_name:name,phone,email:document.getElementById('f_email').value.trim(),
      vehicle_year:document.getElementById('f_year').value.trim(),
      vehicle_make:document.getElementById('f_make').value.trim(),
      vehicle_model:document.getElementById('f_model').value.trim(),
      vin:document.getElementById('f_vin').value.trim().toUpperCase(),
      service_type:document.getElementById('f_type').value,
      description:document.getElementById('f_desc').value.trim(),
      preferred_date:document.getElementById('f_date').value,
      preferred_time:document.getElementById('f_time').value,
      service_address:document.getElementById('f_address').value.trim()
    })});
    const d=await r.json();
    if(d.success){document.getElementById('form').style.display='none';document.getElementById('success').style.display='block';}
    else{throw new Error(d.error||'Submission failed');}
  }catch(e){
    document.getElementById('errorMsg').textContent=e.message;document.getElementById('errorMsg').style.display='block';
    btn.disabled=false;btn.textContent='Submit Service Request';
  }
}
</script>
</body></html>`;
}

// ─── MOBILE WEB APP ──────────────────────────────────────────────
const MOBILE_DIR = path.join(__dirname, "mobile");
if (fs.existsSync(MOBILE_DIR)) {
  app.use("/m", express.static(MOBILE_DIR));
}

// ─── HEALTH CHECK ────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "2.6.4", server: "Good Car Solutions" });
});

// ─── START (async because sql.js init is async) ──────────────────
async function start() {
  // Initialize database first
  await getDb();
  await migrateSchema();
  console.log("");
  console.log("  ==========================================");
  console.log("   Good Car Solutions - Data Server v2.6.4  ");
  console.log("  ==========================================");
  console.log("");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`  [OK] Running on port ${PORT}`);
    console.log(`  [OK] Database: ${path.resolve(__dirname, "gcs-data.db")}`);
    console.log(`  [OK] Data:     ${DATA_HOME}`);
    console.log(`  [OK] Database: ${path.join(DATA_HOME, 'gcs-data.db')}`);
    console.log(`  [OK] Uploads:  ${path.resolve(UPLOADS_DIR)}`);
    console.log("");

    const os = require("os");
    const ifaces = os.networkInterfaces();
    console.log("  Connect from other PCs using:");
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) {
          console.log(`    Desktop:  http://${addr.address}:${PORT}`);
          console.log(`    Mobile:   http://${addr.address}:${PORT}/m/`);
        }
      }
    }
    console.log("");
    console.log("  Default login: admin / admin");
    console.log("  WARNING: Change this password after first login!");
    console.log("");
  });
}

start().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
