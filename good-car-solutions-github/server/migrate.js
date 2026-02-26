/**
 * GCS Server — Migration Tool
 * Imports existing local JSON data into the SQLite database
 * 
 * Usage: node migrate.js <path-to-gcs-data.json>
 * 
 * The JSON file is typically at:
 *   %APPDATA%/good-car-solutions/gcs-data.json
 */
const path = require("path");
const fs = require("fs");

const jsonPath = process.argv[2];

if (!jsonPath) {
  console.log("");
  console.log("  GCS Data Migration Tool");
  console.log("  ----------------------------------------");
  console.log("  Usage: node migrate.js <path-to-gcs-data.json>");
  console.log("");
  console.log("  Your data file is usually at:");
  console.log("    %APPDATA%\\good-car-solutions\\gcs-data.json");
  console.log("");
  process.exit(1);
}

if (!fs.existsSync(jsonPath)) {
  console.error(`  ERROR: File not found: ${jsonPath}`);
  process.exit(1);
}

async function doMigrate() {
  const { getDb, query, run, setSetting, saveDb } = require("./db");
  await getDb();

  console.log("");
  console.log("  GCS Data Migration");
  console.log("  ----------------------------------------");
  console.log(`  Source: ${path.resolve(jsonPath)}`);
  console.log("");

  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  // Customers
  const customers = raw.customers || [];
  let custCount = 0;
  for (const c of customers) {
    run("INSERT OR REPLACE INTO customers (id, name, contact, phone, email, type, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [c.id, c.name || "", c.contact || "", c.phone || "", c.email || "", c.type || "Independent Shop", c.address || "", c.notes || ""]);
    custCount++;
  }
  console.log(`  [OK] Customers: ${custCount} imported`);

  // Jobs
  const jobs = raw.jobs || [];
  let jobCount = 0;

  // Clear timeline/payments for clean re-import
  run("DELETE FROM job_timeline");
  run("DELETE FROM payments");

  for (const j of jobs) {
    const now = new Date().toISOString();
    run(`INSERT OR REPLACE INTO jobs (id, vehicle, vin, customer, customer_id, type, ecu, tools, priority, status, amount, paid, date, service_address, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [j.id, j.vehicle || "", j.vin || "", j.customer || "", j.customerId || "",
       j.type || "ECU Programming", j.ecu || "", j.tools || "", j.priority || "Medium",
       j.status || "Scheduled", j.amount || 0, j.paid ? 1 : 0, j.date || "",
       j.serviceAddress || "", j.createdAt || now, j.updatedAt || now]);

    const notes = Array.isArray(j.notes) ? j.notes : [];
    for (const entry of notes) {
      if (typeof entry === "string") {
        run("INSERT INTO job_timeline (job_id, type, text, timestamp, created_by) VALUES (?, ?, ?, ?, ?)",
          [j.id, "note", entry, now, "migrated"]);
      } else {
        run("INSERT INTO job_timeline (job_id, type, text, file_json, timestamp, created_by) VALUES (?, ?, ?, ?, ?, ?)",
          [j.id, entry.type || "note", entry.text || "",
           entry.file ? JSON.stringify(entry.file) : null,
           entry.timestamp || now, entry.createdBy || "migrated"]);
      }
    }

    const payments = Array.isArray(j.payments) ? j.payments : [];
    for (const p of payments) {
      run("INSERT INTO payments (job_id, amount, note, date, created_by) VALUES (?, ?, ?, ?, ?)",
        [j.id, p.amount || 0, p.note || "Payment", p.date || now, p.createdBy || "migrated"]);
    }
    jobCount++;
  }
  console.log(`  [OK] Jobs: ${jobCount} imported (with timeline & payments)`);

  // Knowledge Base
  const kb = raw.knowledgeBase || {};
  let kbCount = 0;
  for (const [cat, entries] of Object.entries(kb)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const id = e.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      run("INSERT OR REPLACE INTO kb_entries (id, category, title, content, tags, updated) VALUES (?, ?, ?, ?, ?, ?)",
        [id, cat, e.title || "", e.content || "", JSON.stringify(e.tags || []), e.updated || ""]);
      kbCount++;
    }
  }
  console.log(`  [OK] Knowledge Base: ${kbCount} entries imported`);

  // Vehicles
  const vehicles = raw.vehicles || [];
  let vehCount = 0;
  for (const v of vehicles) {
    const id = v.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    run("INSERT OR REPLACE INTO vehicles (id, make, model, years, engines, ecus, modules, protocols, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, v.make || "", v.model || "", v.years || "",
       JSON.stringify(v.engines || []), JSON.stringify(v.ecus || []),
       JSON.stringify(v.modules || []), JSON.stringify(v.protocols || []), v.notes || ""]);
    vehCount++;
  }
  console.log(`  [OK] Vehicles: ${vehCount} imported`);

  // Settings
  const settings = raw.settings || {};
  let setCount = 0;
  for (const [k, v] of Object.entries(settings)) {
    setSetting(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    setCount++;
  }
  console.log(`  [OK] Settings: ${setCount} imported`);

  saveDb();
  console.log("");
  console.log("  ========================================");
  console.log("  Migration complete! Start the server:");
  console.log("    node server.js");
  console.log("  ========================================");
  console.log("");
}

doMigrate().catch(err => {
  console.error("  Migration failed:", err.message);
  process.exit(1);
});
