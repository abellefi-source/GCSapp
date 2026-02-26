const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─── Simple Local JSON Store ─────────────────────────────────────
class JsonStore {
  constructor(name, defaults) {
    const userDataPath = app.getPath("userData");
    this.filePath = path.join(userDataPath, `${name}.json`);
    this.defaults = defaults;
    this.data = this._load();
  }
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        return { ...this.defaults, ...JSON.parse(raw) };
      }
    } catch (e) { console.error("Load error:", e); }
    return { ...this.defaults };
  }
  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) { console.error("Save error:", e); }
  }
  get(key) {
    if (key.includes(".")) return key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), this.data);
    return this.data[key];
  }
  set(key, value) {
    if (key.includes(".")) {
      const keys = key.split(".");
      let obj = this.data;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
    } else { this.data[key] = value; }
    this._save();
  }
  get path() { return this.filePath; }
}

let store, mainWindow, filesDir;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 950, minHeight: 650,
    title: "Good Car Solutions v2.6.4",
    backgroundColor: "#070a0e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false
    },
    autoHideMenuBar: true, show: false
  });
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

app.whenReady().then(() => {
  // Create files storage directory
  filesDir = path.join(app.getPath("userData"), "job-files");
  if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });

  store = new JsonStore("gcs-data", {
    jobs: [], customers: [],
    knowledgeBase: { procedures: [], dtcMaps: [], fileLibrary: [] },
    vehicles: [],
    settings: { companyName: "Good Car Solutions", nextJobNumber: 1, defaultJobPrefix: "GCS" }
  });
  createWindow();
});

app.on("window-all-closed", () => app.quit());

// ─── Helper ──────────────────────────────────────────────────────
function generateJobId() {
  const s = store.get("settings");
  const num = String(s.nextJobNumber).padStart(4, "0");
  store.set("settings.nextJobNumber", s.nextJobNumber + 1);
  return `${s.defaultJobPrefix}-${new Date().getFullYear()}-${num}`;
}
function uid() { return Date.now().toString(36) + crypto.randomBytes(4).toString("hex"); }

// ─── IPC: JOBS ───────────────────────────────────────────────────
ipcMain.handle("jobs:getAll", () => store.get("jobs"));
ipcMain.handle("jobs:create", (e, d) => {
  const jobs = store.get("jobs");
  const nj = { ...d, id: generateJobId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  jobs.unshift(nj); store.set("jobs", jobs); return nj;
});
ipcMain.handle("jobs:update", (e, { id, updates }) => {
  const jobs = store.get("jobs");
  const i = jobs.findIndex(j => j.id === id);
  if (i === -1) return null;
  jobs[i] = { ...jobs[i], ...updates, updatedAt: new Date().toISOString() };
  store.set("jobs", jobs); return jobs[i];
});
ipcMain.handle("jobs:delete", (e, id) => {
  store.set("jobs", store.get("jobs").filter(j => j.id !== id)); return true;
});

// ─── IPC: CUSTOMERS ──────────────────────────────────────────────
ipcMain.handle("customers:getAll", () => store.get("customers"));
ipcMain.handle("customers:create", (e, d) => {
  const c = store.get("customers");
  const nc = { ...d, id: uid(), jobCount: 0, totalRevenue: 0, createdAt: new Date().toISOString() };
  c.push(nc); store.set("customers", c); return nc;
});
ipcMain.handle("customers:update", (e, { id, updates }) => {
  const c = store.get("customers");
  const i = c.findIndex(x => x.id === id);
  if (i === -1) return null;
  c[i] = { ...c[i], ...updates };
  store.set("customers", c); return c[i];
});
ipcMain.handle("customers:delete", (e, id) => {
  store.set("customers", store.get("customers").filter(c => c.id !== id)); return true;
});

// ─── IPC: KNOWLEDGE BASE ─────────────────────────────────────────
ipcMain.handle("kb:getAll", () => store.get("knowledgeBase"));
ipcMain.handle("kb:addEntry", (e, { category, entry }) => {
  const kb = store.get("knowledgeBase");
  const ne = { ...entry, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (!kb[category]) kb[category] = [];
  kb[category].push(ne); store.set("knowledgeBase", kb); return ne;
});
ipcMain.handle("kb:updateEntry", (e, { category, id, updates }) => {
  const kb = store.get("knowledgeBase");
  const i = kb[category]?.findIndex(x => x.id === id);
  if (i === -1 || i === undefined) return null;
  kb[category][i] = { ...kb[category][i], ...updates, updatedAt: new Date().toISOString() };
  store.set("knowledgeBase", kb); return kb[category][i];
});
ipcMain.handle("kb:deleteEntry", (e, { category, id }) => {
  const kb = store.get("knowledgeBase");
  if (kb[category]) { kb[category] = kb[category].filter(x => x.id !== id); store.set("knowledgeBase", kb); }
  return true;
});

// ─── IPC: VEHICLES ───────────────────────────────────────────────
ipcMain.handle("vehicles:getAll", () => store.get("vehicles"));
ipcMain.handle("vehicles:create", (e, d) => {
  const v = store.get("vehicles");
  const nv = { ...d, id: uid(), createdAt: new Date().toISOString() };
  v.push(nv); store.set("vehicles", v); return nv;
});
ipcMain.handle("vehicles:update", (e, { id, updates }) => {
  const v = store.get("vehicles");
  const i = v.findIndex(x => x.id === id);
  if (i === -1) return null;
  v[i] = { ...v[i], ...updates }; store.set("vehicles", v); return v[i];
});
ipcMain.handle("vehicles:delete", (e, id) => {
  store.set("vehicles", store.get("vehicles").filter(v => v.id !== id)); return true;
});

// ─── IPC: FILES (Attachments) ────────────────────────────────────
ipcMain.handle("files:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Attach Files to Work Order",
    filters: [
      { name: "All Supported", extensions: ["pdf", "bin", "hex", "ori", "mod", "jpg", "jpeg", "png", "txt", "csv", "doc", "docx", "xls", "xlsx"] },
      { name: "Binary/ECU Files", extensions: ["bin", "hex", "ori", "mod"] },
      { name: "Documents", extensions: ["pdf", "doc", "docx", "txt", "csv", "xls", "xlsx"] },
      { name: "Images", extensions: ["jpg", "jpeg", "png"] },
      { name: "All Files", extensions: ["*"] }
    ],
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const saved = [];
  for (const fp of result.filePaths) {
    const ext = path.extname(fp);
    const origName = path.basename(fp);
    const fileId = uid();
    const storedName = `${fileId}${ext}`;
    const dest = path.join(filesDir, storedName);
    fs.copyFileSync(fp, dest);
    const stats = fs.statSync(dest);
    saved.push({
      id: fileId, originalName: origName, storedName: storedName,
      extension: ext.toLowerCase().replace(".", ""),
      size: stats.size, addedAt: new Date().toISOString()
    });
  }
  return saved;
});

ipcMain.handle("files:open", (e, storedName) => {
  const fp = path.join(filesDir, storedName);
  if (fs.existsSync(fp)) { shell.openPath(fp); return true; }
  return false;
});

ipcMain.handle("files:showInFolder", (e, storedName) => {
  const fp = path.join(filesDir, storedName);
  if (fs.existsSync(fp)) { shell.showItemInFolder(fp); return true; }
  return false;
});

ipcMain.handle("files:delete", (e, storedName) => {
  const fp = path.join(filesDir, storedName);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (err) { console.error(err); }
  return true;
});

// ─── IPC: SETTINGS ───────────────────────────────────────────────
ipcMain.handle("settings:get", () => store.get("settings"));
ipcMain.handle("settings:update", (e, u) => {
  store.set("settings", { ...store.get("settings"), ...u });
  return store.get("settings");
});

// ─── IPC: DATA MANAGEMENT ────────────────────────────────────────
ipcMain.handle("data:export", async () => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "Export GCS Data", defaultPath: `gcs-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON Files", extensions: ["json"] }]
  });
  if (!r.canceled && r.filePath) {
    const all = { jobs: store.get("jobs"), customers: store.get("customers"), knowledgeBase: store.get("knowledgeBase"), vehicles: store.get("vehicles"), settings: store.get("settings"), exportedAt: new Date().toISOString(), version: "2.2.0" };
    fs.writeFileSync(r.filePath, JSON.stringify(all, null, 2));
    return { success: true, path: r.filePath };
  }
  return { success: false };
});
ipcMain.handle("data:import", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Import GCS Data", filters: [{ name: "JSON", extensions: ["json"] }], properties: ["openFile"]
  });
  if (!r.canceled && r.filePaths.length) {
    try {
      const d = JSON.parse(fs.readFileSync(r.filePaths[0], "utf-8"));
      if (d.jobs) store.set("jobs", d.jobs);
      if (d.customers) store.set("customers", d.customers);
      if (d.knowledgeBase) store.set("knowledgeBase", d.knowledgeBase);
      if (d.vehicles) store.set("vehicles", d.vehicles);
      if (d.settings) store.set("settings", d.settings);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }
  return { success: false };
});
ipcMain.handle("data:getStorePath", () => store.path);
ipcMain.handle("data:openStoreFolder", () => { shell.showItemInFolder(store.path); return true; });

// ─── EXIF Orientation Reader (phone photos store rotation in metadata) ───
function getExifOrientation(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(65536); // read first 64KB — EXIF is always near start
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return 1; // not JPEG
    let pos = 2;
    while (pos < buf.length - 4) {
      if (buf[pos] !== 0xFF) return 1;
      const marker = buf[pos + 1];
      const len = buf.readUInt16BE(pos + 2);
      if (marker === 0xE1) { // APP1 = EXIF
        const exifStart = pos + 4;
        if (buf.toString("ascii", exifStart, exifStart + 4) !== "Exif") return 1;
        const tiffStart = exifStart + 6;
        const bigEndian = buf.readUInt16BE(tiffStart) === 0x4D4D;
        const r16 = (o) => bigEndian ? buf.readUInt16BE(o) : buf.readUInt16LE(o);
        const r32 = (o) => bigEndian ? buf.readUInt32BE(o) : buf.readUInt32LE(o);
        const ifdOffset = tiffStart + r32(tiffStart + 4);
        const entries = r16(ifdOffset);
        for (let i = 0; i < entries; i++) {
          const entryOff = ifdOffset + 2 + i * 12;
          if (r16(entryOff) === 0x0112) { // Orientation tag
            return r16(entryOff + 8);
          }
        }
        return 1;
      }
      pos += 2 + len;
    }
  } catch (e) {}
  return 1; // default: normal
}

// ─── IPC: INVOICES ───────────────────────────────────────────────
ipcMain.handle("invoice:generate", async (e, invoiceData) => {
  try {
    const { generateInvoice, mergeWithAttachments } = require("./invoice-generator");
    const tmpDir = path.join(app.getPath("userData"), "invoices");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const invoiceNo = invoiceData.invoiceNo || Date.now();
    const tmpPath = path.join(tmpDir, `invoice_${invoiceNo}_tmp.pdf`);
    const finalPath = path.join(tmpDir, `invoice_${invoiceNo}.pdf`);

    // Separate image paths from PDF paths
    const allPaths = invoiceData.attachmentPaths || [];
    const imgExts = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const pdfPaths = [];
    const imagePages = [];

    for (const p of allPaths) {
      if (!p || !fs.existsSync(p)) continue;
      const ext = path.extname(p).toLowerCase();
      if (ext === ".pdf") {
        pdfPaths.push(p);
      } else if (imgExts.includes(ext)) {
        // Resize and compress image for email-friendly PDF size
        try {
          // Read EXIF orientation BEFORE nativeImage strips it
          const orientation = getExifOrientation(p);
          const img = nativeImage.createFromPath(p);
          const size = img.getSize();
          // Resize to max 1200px on longest side
          const maxDim = 1200;
          let resized = img;
          if (size.width > maxDim || size.height > maxDim) {
            if (size.width >= size.height) {
              resized = img.resize({ width: maxDim });
            } else {
              resized = img.resize({ height: maxDim });
            }
          }
          // Convert to JPEG at 70% quality — drastically reduces size
          const jpegBuffer = resized.toJPEG(70);
          const base64 = jpegBuffer.toString("base64");
          const caption = "Photo Attachment";
          // Pass EXIF orientation so HTML template can apply CSS rotation
          // 1=normal, 3=180°, 6=90°CW, 8=90°CCW
          imagePages.push({ base64, mime: "image/jpeg", caption, orientation });
        } catch (imgErr) {
          console.error(`Failed to process image ${p}:`, imgErr.message);
        }
      }
    }

    // Inject image pages into invoice data so buildInvoiceHTML renders them
    invoiceData.imagePages = imagePages;

    // Generate the main invoice PDF (with images baked into HTML)
    await generateInvoice(invoiceData, tmpPath);

    // Merge PDF attachments only (images already in the HTML)
    if (pdfPaths.length > 0) {
      await mergeWithAttachments(tmpPath, pdfPaths, finalPath);
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    } else {
      if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, finalPath);
    }

    return { success: true, path: finalPath, invoiceNo };
  } catch (err) {
    console.error("Invoice generation error:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("invoice:save", async (e, { sourcePath, suggestedName }) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: "Save Invoice",
    defaultPath: suggestedName || "invoice.pdf",
    filters: [{ name: "PDF Files", extensions: ["pdf"] }]
  });
  if (!r.canceled && r.filePath) {
    fs.copyFileSync(sourcePath, r.filePath);
    return { success: true, path: r.filePath };
  }
  return { success: false };
});

ipcMain.handle("invoice:open", (e, filePath) => {
  if (fs.existsSync(filePath)) { shell.openPath(filePath); return true; }
  return false;
});

ipcMain.handle("invoice:getNextNumber", () => {
  const s = store.get("settings");
  const num = s.nextInvoiceNumber || 14831365;
  return num;
});

ipcMain.handle("invoice:incrementNumber", () => {
  const s = store.get("settings");
  const num = (s.nextInvoiceNumber || 14831365) + 1;
  store.set("settings.nextInvoiceNumber", num);
  return num;
});

ipcMain.handle("files:getPath", (e, storedName) => {
  return path.join(filesDir, storedName);
});

// Preview file as base64 data URL
ipcMain.handle("files:previewData", (e, storedName) => {
  const fp = path.join(filesDir, storedName);
  if (!fs.existsSync(fp)) return null;
  const data = fs.readFileSync(fp);
  const ext = path.extname(storedName).toLowerCase();
  const mimes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf" };
  const mime = mimes[ext] || "application/octet-stream";
  return `data:${mime};base64,${data.toString("base64")}`;
});

// ─── IPC: SERVER FILE OPERATIONS ─────────────────────────────────
// Upload files to server (pick locally, send via multipart HTTP)
ipcMain.handle("server:files:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Attach Files to Work Order",
    filters: [
      { name: "All Supported", extensions: ["pdf", "bin", "hex", "ori", "mod", "jpg", "jpeg", "png", "txt", "csv", "doc", "docx", "xls", "xlsx"] },
      { name: "Binary/ECU Files", extensions: ["bin", "hex", "ori", "mod"] },
      { name: "Documents", extensions: ["pdf", "doc", "docx", "txt", "csv", "xls", "xlsx"] },
      { name: "Images", extensions: ["jpg", "jpeg", "png"] },
      { name: "All Files", extensions: ["*"] }
    ],
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled || !result.filePaths.length) return null;

  // Upload each file to the server
  try {
    const uploaded = await uploadFilesToServer(result.filePaths);
    return uploaded;
  } catch (err) {
    console.error("Server upload error:", err);
    return null;
  }
});

async function uploadFilesToServer(filePaths) {
  const url = new URL(serverClient.baseUrl + "/api/files/upload");
  const boundary = "----GCSBoundary" + Date.now().toString(36);
  const mod = url.protocol === "https:" ? require("https") : require("http");

  return new Promise((resolve, reject) => {
    // Build multipart body
    const parts = [];
    for (const fp of filePaths) {
      const filename = path.basename(fp);
      const fileData = fs.readFileSync(fp);
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        fileData,
        Buffer.from("\r\n")
      );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
        ...(serverClient.token ? { Authorization: `Bearer ${serverClient.token}` } : {})
      },
      timeout: 60000
    };

    const req = mod.request(opts, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.error || `HTTP ${res.statusCode}`));
          else resolve(json);
        } catch (e) { reject(new Error("Invalid server response")); }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Upload timed out")); });
    req.write(body);
    req.end();
  });
}

// Download a file from server to local cache, then open it
ipcMain.handle("server:files:open", async (e, storedName) => {
  try {
    const localPath = await downloadServerFile(storedName);
    if (localPath) { shell.openPath(localPath); return true; }
    return false;
  } catch (err) { console.error("File open error:", err); return false; }
});

ipcMain.handle("server:files:showInFolder", async (e, storedName) => {
  try {
    const localPath = await downloadServerFile(storedName);
    if (localPath) { shell.showItemInFolder(localPath); return true; }
    return false;
  } catch (err) { return false; }
});

ipcMain.handle("server:files:getPath", async (e, storedName) => {
  try {
    return await downloadServerFile(storedName);
  } catch (err) { 
    console.error("File download error:", err);
    // Fallback to local
    return path.join(filesDir, storedName);
  }
});

// Server preview file as base64 data URL
ipcMain.handle("server:files:previewData", async (e, storedName) => {
  try {
    const localPath = await downloadServerFile(storedName);
    if (!localPath || !fs.existsSync(localPath)) return null;
    const data = fs.readFileSync(localPath);
    const ext = path.extname(storedName).toLowerCase();
    const mimes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf" };
    const mime = mimes[ext] || "application/octet-stream";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch (err) { return null; }
});

async function downloadServerFile(storedName) {
  // Check local cache first
  const cacheDir = path.join(app.getPath("userData"), "file-cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const localPath = path.join(cacheDir, storedName);
  if (fs.existsSync(localPath)) return localPath;

  // Download from server
  const url = new URL(serverClient.baseUrl + `/api/files/${encodeURIComponent(storedName)}`);
  const mod = url.protocol === "https:" ? require("https") : require("http");

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      headers: {
        ...(serverClient.token ? { Authorization: `Bearer ${serverClient.token}` } : {})
      },
      timeout: 30000
    };

    const req = mod.request(opts, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(localPath);
      res.pipe(fileStream);
      fileStream.on("finish", () => { fileStream.close(); resolve(localPath); });
      fileStream.on("error", reject);
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Download timed out")); });
    req.end();
  });
}

// ─── IPC: SERVER CONNECTION ──────────────────────────────────────
const { ServerClient } = require("./server-client");
const serverClient = new ServerClient();

// Config persistence
function getConnectionConfig() {
  try {
    const cfgPath = path.join(app.getPath("userData"), "server-config.json");
    if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  } catch (e) {}
  return { serverUrl: "", autoConnect: false };
}
function saveConnectionConfig(cfg) {
  const cfgPath = path.join(app.getPath("userData"), "server-config.json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

ipcMain.handle("server:loadConfig", () => getConnectionConfig());
ipcMain.handle("server:saveConfig", (e, cfg) => { saveConnectionConfig(cfg); return true; });

ipcMain.handle("server:healthCheck", async (e, url) => {
  try { return await serverClient.healthCheck(url); }
  catch (err) { return { error: err.message }; }
});

// Generic server request proxy for new features (teams, appointments, notifications, intake)
ipcMain.handle("server:request", async (e, { method, path, body }) => {
  try { return await serverClient.request(method, path, body); }
  catch (err) { return { error: err.message }; }
});
ipcMain.handle("server:getBaseUrl", () => serverClient.baseUrl || "");

ipcMain.handle("server:login", async (e, { url, username, password }) => {
  try {
    const r = await serverClient.login(url, username, password);
    return { success: true, user: r.user, token: r.token };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle("server:logout", () => { serverClient.logout(); return true; });
ipcMain.handle("server:isConnected", () => ({ connected: serverClient.connected, user: serverClient.user }));

// Server-proxied data operations
ipcMain.handle("server:jobs:getAll", async () => {
  try { return { data: await serverClient.getJobs() }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:jobs:create", async (e, d) => {
  try { return { data: await serverClient.createJob(d) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:jobs:update", async (e, { id, updates }) => {
  try { return { data: await serverClient.updateJob(id, updates) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:jobs:delete", async (e, id) => {
  try { return { data: await serverClient.deleteJob(id) }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("server:customers:getAll", async () => {
  try { return { data: await serverClient.getCustomers() }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:customers:create", async (e, d) => {
  try { return { data: await serverClient.createCustomer(d) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:customers:update", async (e, { id, updates }) => {
  try { return { data: await serverClient.updateCustomer(id, updates) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:customers:delete", async (e, id) => {
  try { return { data: await serverClient.deleteCustomer(id) }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("server:kb:getAll", async () => {
  try { return { data: await serverClient.getKb() }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:kb:addEntry", async (e, { category, entry }) => {
  try { return { data: await serverClient.addKbEntry(category, entry) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:kb:deleteEntry", async (e, { category, id }) => {
  try { return { data: await serverClient.deleteKbEntry(category, id) }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("server:vehicles:getAll", async () => {
  try { return { data: await serverClient.getVehicles() }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:vehicles:create", async (e, d) => {
  try { return { data: await serverClient.createVehicle(d) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:vehicles:delete", async (e, id) => {
  try { return { data: await serverClient.deleteVehicle(id) }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("server:users:getAll", async () => {
  try { return { data: await serverClient.getUsers() }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:users:create", async (e, d) => {
  try { return { data: await serverClient.createUser(d) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:users:update", async (e, { id, data }) => {
  try { return { data: await serverClient.updateUser(id, data) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:users:delete", async (e, id) => {
  try { return { data: await serverClient.deleteUser(id) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:changePassword", async (e, { currentPassword, newPassword }) => {
  try { return { data: await serverClient.changePassword(currentPassword, newPassword) }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("server:settings:get", async () => {
  try { return { data: await serverClient.getSettings() }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("server:invoice:getNextNumber", async () => {
  try { return await serverClient.getNextInvoiceNumber(); }
  catch (e) { return 14831365; }
});
ipcMain.handle("server:invoice:incrementNumber", async () => {
  try { return await serverClient.incrementInvoiceNumber(); }
  catch (e) { return 14831365; }
});

// Stripe
ipcMain.handle("server:stripe:configStatus", async () => {
  try { return await serverClient.request("GET", "/stripe/config-status"); }
  catch (e) { return { configured: false, error: e.message }; }
});
ipcMain.handle("server:stripe:test", async (e, apiKey) => {
  try { return await serverClient.request("POST", "/stripe/test", { apiKey }); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:stripe:configure", async (e, apiKey) => {
  try { return await serverClient.request("POST", "/stripe/configure", { apiKey }); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:stripe:createPaymentLink", async (e, data) => {
  try { return await serverClient.request("POST", "/stripe/payment-link", data); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:stripe:paymentStatus", async (e, linkId) => {
  try { return await serverClient.request("GET", `/stripe/payment-status/${linkId}`); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:stripe:links", async () => {
  try { return await serverClient.request("GET", "/stripe/links"); }
  catch (e) { return []; }
});

// Email
ipcMain.handle("server:email:configStatus", async () => {
  try { return await serverClient.request("GET", "/email/config-status"); }
  catch (e) { return { configured: false, error: e.message }; }
});
ipcMain.handle("server:email:configure", async (e, data) => {
  try { return await serverClient.request("POST", "/email/configure", data); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:email:test", async (e, data) => {
  try { return await serverClient.request("POST", "/email/test", data); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:email:sendInvoice", async (e, data) => {
  try { return await serverClient.request("POST", "/email/send-invoice", data); }
  catch (e) { return { error: e.message }; }
});

// Estimates
ipcMain.handle("server:estimates:getAll", async () => {
  try { return await serverClient.request("GET", "/estimates"); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:estimates:create", async (e, d) => {
  try { return await serverClient.request("POST", "/estimates", d); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:estimates:update", async (e, { id, data }) => {
  try { return await serverClient.request("PUT", `/estimates/${id}`, data); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:estimates:delete", async (e, id) => {
  try { return await serverClient.request("DELETE", `/estimates/${id}`); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:estimates:convert", async (e, id) => {
  try { return await serverClient.request("POST", `/estimates/${id}/convert`); }
  catch (e) { return { error: e.message }; }
});

// Agreements
ipcMain.handle("server:agreements:getAll", async () => {
  try { return await serverClient.request("GET", "/agreements"); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle("server:agreements:create", async (e, d) => {
  try { return await serverClient.request("POST", "/agreements", d); }
  catch (e) { return { error: e.message }; }
});
