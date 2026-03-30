/**
 * GCS Server — Database Layer (sql.js — pure JavaScript SQLite)
 */
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

// Stable data directory — never moves between versions
const DATA_HOME = process.env.GCS_DATA_DIR || (process.platform === "win32"
  ? path.join(process.env.ProgramData || "C:\\ProgramData", "GoodCarSolutions")
  : path.join(require("os").homedir(), ".gcs-server"));
if (!fs.existsSync(DATA_HOME)) fs.mkdirSync(DATA_HOME, { recursive: true });

const DB_PATH = path.join(DATA_HOME, "gcs-data.db");

// Migrate from old location if exists
const OLD_DB = path.join(__dirname, "gcs-data.db");
if (!fs.existsSync(DB_PATH) && fs.existsSync(OLD_DB)) {
  fs.copyFileSync(OLD_DB, DB_PATH);
  console.log(`  [MIGRATE] Copied database from ${OLD_DB} -> ${DB_PATH}`);
}

let db = null;
let initPromise = null;

// sql.js is async to initialize, then synchronous for queries
async function getDb() {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }

    initSchema();
    return db;
  })();

  return initPromise;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buf = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buf);
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'technician',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      type TEXT DEFAULT 'Independent Shop',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      vehicle TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      customer TEXT DEFAULT '',
      customer_id TEXT DEFAULT '',
      type TEXT DEFAULT 'ECU Programming',
      ecu TEXT DEFAULT '',
      tools TEXT DEFAULT '',
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Scheduled',
      amount REAL DEFAULT 0,
      paid INTEGER DEFAULT 0,
      date TEXT DEFAULT '',
      service_address TEXT DEFAULT '',
      team_id TEXT DEFAULT '',
      scheduled_start TEXT DEFAULT '',
      scheduled_end TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS job_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note',
      text TEXT DEFAULT '',
      file_json TEXT DEFAULT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      created_by TEXT DEFAULT '',
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT DEFAULT 'Payment',
      date TEXT DEFAULT (datetime('now')),
      created_by TEXT DEFAULT '',
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kb_entries (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      updated TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      make TEXT DEFAULT '',
      model TEXT DEFAULT '',
      years TEXT DEFAULT '',
      engines TEXT DEFAULT '[]',
      ecus TEXT DEFAULT '[]',
      modules TEXT DEFAULT '[]',
      protocols TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS estimates (
      id TEXT PRIMARY KEY,
      caller_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      vehicle_year TEXT DEFAULT '',
      vehicle_make TEXT DEFAULT '',
      vehicle_model TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      service_type TEXT DEFAULT 'ECU Programming',
      modules TEXT DEFAULT '',
      description TEXT DEFAULT '',
      price REAL DEFAULT 0,
      status TEXT DEFAULT 'New',
      notes TEXT DEFAULT '',
      converted_job_id TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS agreements (
      id TEXT PRIMARY KEY,
      job_id TEXT DEFAULT '',
      estimate_id TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      customer_email TEXT DEFAULT '',
      vehicle TEXT DEFAULT '',
      scope_of_work TEXT DEFAULT '',
      amount REAL DEFAULT 0,
      signature_data TEXT DEFAULT '',
      signed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_no TEXT DEFAULT '',
      job_id TEXT DEFAULT '',
      bill_to TEXT DEFAULT '',
      bill_to_phone TEXT DEFAULT '',
      bill_to_email TEXT DEFAULT '',
      vehicle TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      line_items TEXT DEFAULT '[]',
      subtotal REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      payment_instructions TEXT DEFAULT '',
      comments TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      terms TEXT DEFAULT 'NET 0',
      date TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      payment_url TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      include_images INTEGER DEFAULT 0,
      include_pdfs INTEGER DEFAULT 0,
      viewed_at TEXT DEFAULT '',
      view_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#f97316',
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(team_id, user_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      job_id TEXT DEFAULT '',
      title TEXT DEFAULT '',
      customer TEXT DEFAULT '',
      vehicle TEXT DEFAULT '',
      service_address TEXT DEFAULT '',
      date TEXT NOT NULL,
      time_start TEXT DEFAULT '09:00',
      time_end TEXT DEFAULT '10:00',
      team_id TEXT DEFAULT '',
      assigned_to TEXT DEFAULT '',
      status TEXT DEFAULT 'Scheduled',
      notes TEXT DEFAULT '',
      lat REAL DEFAULT 0,
      lng REAL DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT DEFAULT 'info',
      title TEXT DEFAULT '',
      message TEXT DEFAULT '',
      link TEXT DEFAULT '',
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS intake_submissions (
      id TEXT PRIMARY KEY,
      customer_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      vehicle_year TEXT DEFAULT '',
      vehicle_make TEXT DEFAULT '',
      vehicle_model TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      service_type TEXT DEFAULT '',
      description TEXT DEFAULT '',
      preferred_date TEXT DEFAULT '',
      preferred_time TEXT DEFAULT '',
      service_address TEXT DEFAULT '',
      photos TEXT DEFAULT '[]',
      status TEXT DEFAULT 'New',
      converted_estimate_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS receptionist_calls (
      id TEXT PRIMARY KEY,
      call_sid TEXT DEFAULT '',
      caller_phone TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      intake_id TEXT DEFAULT '',
      status TEXT DEFAULT 'in_progress',
      duration INTEGER DEFAULT 0,
      transcript TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create default admin if no users
  const res = query("SELECT COUNT(*) as c FROM users");
  if (res.length === 0 || res[0].c === 0) {
    const hash = bcrypt.hashSync("admin", 10);
    db.run("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
      ["admin", hash, "Administrator", "admin"]);
    console.log("  Created default admin user (admin / admin)");
    console.log("  WARNING: Change this password after first login!");
  }

  // Default settings
  const sRes = query("SELECT COUNT(*) as c FROM settings");
  if (sRes.length === 0 || sRes[0].c === 0) {
    const defaults = {
      companyName: "Good Car Solutions",
      nextJobNumber: "1",
      defaultJobPrefix: "GCS",
      nextInvoiceNumber: "14831365"
    };
    for (const [k, v] of Object.entries(defaults)) {
      db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [k, v]);
    }
  }

  db.run("PRAGMA foreign_keys = ON");
  saveDb();
}

// Helper: run a SELECT and return array of row objects
function query(sql, params) {
  if (!db) throw new Error("Database not initialized");
  try {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (e) {
    console.error("Query error:", sql, e.message);
    return [];
  }
}

// Helper: run INSERT/UPDATE/DELETE
function run(sql, params) {
  if (!db) throw new Error("Database not initialized");
  if (params) {
    db.run(sql, params);
  } else {
    db.run(sql);
  }
  saveDb();
}

function getSetting(key) {
  const rows = query("SELECT value FROM settings WHERE key = ?", [key]);
  return rows.length > 0 ? rows[0].value : null;
}

function setSetting(key, value) {
  run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
}

module.exports = { getDb, query, run, getSetting, setSetting, saveDb, DB_PATH, DATA_HOME };
