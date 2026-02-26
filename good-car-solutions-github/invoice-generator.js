/**
 * Good Car Solutions — Invoice PDF Generator v2
 * Uses HTML template + Electron printToPDF (zero external deps for main invoice)
 * pdf-lib used only for merging PDF attachments
 */
const { BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

// Load logo as base64 on startup
let logoBase64 = "";
try {
  const logoPath = path.join(__dirname, "src", "logo.png");
  if (fs.existsSync(logoPath)) {
    logoBase64 = fs.readFileSync(logoPath).toString("base64");
  }
} catch (e) { console.error("Logo load error:", e); }

function buildInvoiceHTML(data) {
  const balance = (data.total || 0) - (data.paid || 0);
  const isPaid = balance <= 0 && (data.paid || 0) > 0;

  const lineItemsHTML = (data.lineItems || []).map(li => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${li.description || ""}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;text-align:center">${li.quantity || 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;text-align:right">$${(li.rate || 0).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;text-align:right">$${(li.amount || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  const notesHTML = data.notes ? `
    <div style="margin-top:20px">
      <div style="font-weight:bold;font-size:13px;margin-bottom:6px;border-bottom:1px solid #ddd;padding-bottom:4px">Work Notes</div>
      <div style="font-size:11px;color:#444;white-space:pre-wrap;line-height:1.6">${data.notes.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    </div>
  ` : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Helvetica, Arial, sans-serif; color: #333; width: 8.5in; min-height: 11in; position: relative; padding: 0; }
  .page { width: 8.5in; min-height: 11in; padding: 50px 50px 80px 50px; position: relative; }
  .watermark { position: absolute; top: 15px; left: 0; right: 0; text-align: center; font-size: 72px; font-weight: bold; color: #e8e8e8; letter-spacing: 8px; z-index: 0; }
  .content { position: relative; z-index: 1; }
</style>
</head>
<body>
<div class="page">
  <div class="watermark">INVOICE</div>
  <div class="content">

    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px">
      <div style="font-size:11px;color:#555;line-height:1.7">
        <div>Mobile Service</div>
        <div>Goodcarsolutionstx@gmail.com</div>
        <div>GoodCarSolutionstx.com</div>
        <div>(979) 288-7747 - (832) 951-3325</div>
      </div>
      ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" style="width:200px;height:auto"/>` : ""}
    </div>

    <!-- Invoice Title -->
    <div style="font-size:26px;font-weight:bold;margin-bottom:20px">Invoice</div>

    <!-- Bill To / Invoice Info -->
    <div style="display:flex;justify-content:space-between;margin-bottom:24px">
      <div>
        <div style="font-size:10px;color:#888;margin-bottom:4px">Bill To:</div>
        <div style="font-size:13px;font-weight:bold">${data.billTo || ""}</div>
        <div style="font-size:12px;color:#555">${data.billToPhone || ""}</div>
      </div>
      <div style="text-align:right">
        <table style="font-size:12px;border-collapse:collapse">
          <tr><td style="color:#888;padding:2px 12px">Invoice No:</td><td style="font-weight:500">${data.invoiceNo || ""}</td></tr>
          <tr><td style="color:#888;padding:2px 12px">Date:</td><td>${data.date || ""}</td></tr>
          <tr><td style="color:#888;padding:2px 12px">Terms:</td><td>${data.terms || "NET 0"}</td></tr>
          <tr><td style="color:#888;padding:2px 12px">Due Date:</td><td>${data.dueDate || data.date || ""}</td></tr>
        </table>
      </div>
    </div>

    <!-- Vehicle Info -->
    <div style="border-top:1px solid #ccc;padding-top:12px;margin-bottom:20px">
      <table style="font-size:12px">
        <tr><td style="color:#888;padding:3px 20px 3px 0;width:60px">Vehicle</td><td style="font-size:13px">${data.vehicle || ""}</td></tr>
        <tr><td style="color:#888;padding:3px 20px 3px 0">Vin#</td><td style="font-size:13px">${data.vin || ""}</td></tr>
      </table>
    </div>

    <!-- Line Items -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead>
        <tr style="border-top:2px solid #333;border-bottom:2px solid #333">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:bold">Description</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:bold">Quantity</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:bold">Rate</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:bold">Amount</th>
        </tr>
      </thead>
      <tbody>${lineItemsHTML}</tbody>
    </table>

    <!-- Payment Instructions + Totals -->
    <div style="display:flex;justify-content:space-between;margin-bottom:20px">
      <div style="max-width:280px">
        <div style="font-size:13px;font-weight:bold;margin-bottom:6px">Payment Instructions</div>
        <div style="font-size:10px;color:#555;line-height:1.5">${data.paymentInstructions || ""}</div>
        ${isPaid ? `
        <div style="margin-top:14px;display:inline-block;border:3px solid #cc0000;border-radius:6px;padding:4px 20px">
          <span style="font-size:22px;font-weight:bold;color:#cc0000">Paid</span>
        </div>
        ` : ""}
      </div>
      <div>
        <table style="font-size:12px;border-collapse:collapse;min-width:200px">
          <tr><td style="padding:6px 16px;color:#888">Subtotal</td><td style="padding:6px 0;text-align:right">$${(data.subtotal || 0).toFixed(2)}</td></tr>
          <tr style="border-top:1px solid #ddd"><td style="padding:6px 16px;color:#888">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold">$${(data.total || 0).toFixed(2)}</td></tr>
          <tr style="border-top:1px solid #ddd"><td style="padding:6px 16px;color:#888">Paid</td><td style="padding:6px 0;text-align:right">$${(data.paid || 0).toFixed(2)}</td></tr>
          <tr style="border-top:1px solid #ddd">
            <td style="padding:8px 16px;font-size:14px;font-weight:bold;color:${isPaid ? "#008800" : "#cc0000"}">Balance Due</td>
            <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:bold;color:${isPaid ? "#008800" : "#cc0000"}">$${Math.max(0, balance).toFixed(2)}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Comments -->
    ${(data.comments) ? `
    <div style="margin-top:10px">
      <div style="font-size:13px;font-weight:bold;margin-bottom:6px">Comments</div>
      <div style="font-size:10px;color:#555;line-height:1.5">${data.comments.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    </div>
    ` : ""}

    ${notesHTML}

    <!-- Signature Lines -->
    <div style="margin-top:60px;display:flex;justify-content:space-between">
      <div style="width:45%">
        <div style="border-top:1px solid #333;padding-top:6px;font-size:11px">Good Car Solutions</div>
      </div>
      <div style="width:45%">
        <div style="border-top:1px solid #333;padding-top:6px;font-size:11px">Client's signature</div>
      </div>
    </div>

  </div>
</div>

${(data.imagePages || []).map(img => {
  // Map EXIF orientation to CSS transform
  const o = img.orientation || 1;
  const rot = o === 3 ? 'rotate(180deg)' : o === 6 ? 'rotate(90deg)' : o === 8 ? 'rotate(270deg)' : 'none';
  // For 90/270 rotation, swap the max constraints so rotated image fits page
  const isRotated90 = (o === 6 || o === 8);
  const mw = isRotated90 ? '9.5in' : '7.5in';
  const mh = isRotated90 ? '7.5in' : '9.5in';
  return `
<!-- Photo Page -->
<div style="page-break-before:always;width:8.5in;min-height:11in;padding:40px 50px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden">
  <div style="font-size:10px;color:#999;text-align:center;margin-bottom:12px">${img.caption ? img.caption.replace(/</g,'&lt;').replace(/>/g,'&gt;') : 'Photo Attachment'}</div>
  <img src="data:${img.mime};base64,${img.base64}" style="max-width:${mw};max-height:${mh};width:auto;height:auto;border:1px solid #ddd;border-radius:4px;transform:${rot}"/>
  <div style="font-size:9px;color:#bbb;text-align:center;margin-top:8px">Invoice ${data.invoiceNo || ""} — ${data.date || ""}</div>
</div>
`;}).join("")}

<!-- Footer -->
<div style="position:fixed;bottom:20px;left:0;right:0;text-align:center;font-size:10px;color:#999">
  - Invoice ${data.invoiceNo || ""} - ${data.date || ""} -
</div>

</body>
</html>`;
}

function generateInvoice(invoiceData, outputPath) {
  return new Promise((resolve, reject) => {
    let win = null;
    let tmpHtmlPath = null;
    try {
      win = new BrowserWindow({
        width: 816, height: 1056, show: false,
        webPreferences: { offscreen: true, contextIsolation: true }
      });

      const html = buildInvoiceHTML(invoiceData);
      
      // Write HTML to temp file — data URLs choke on large base64 images
      tmpHtmlPath = outputPath.replace(/\.pdf$/i, "_tmp.html");
      fs.writeFileSync(tmpHtmlPath, html, "utf-8");
      win.loadFile(tmpHtmlPath);

      win.webContents.on("did-finish-load", async () => {
        try {
          // Give it time to fully render images (more time if images are included)
          const hasImages = (invoiceData.imagePages || []).length > 0;
          await new Promise(r => setTimeout(r, hasImages ? 2000 : 800));
          
          const pdfData = await win.webContents.printToPDF({
            printBackground: true,
            pageSize: "Letter",
            margins: { top: 0, bottom: 0, left: 0, right: 0 }
          });

          fs.writeFileSync(outputPath, pdfData);
          if (win && !win.isDestroyed()) { win.close(); }
          win = null;
          // Clean up temp HTML
          try { if (tmpHtmlPath) fs.unlinkSync(tmpHtmlPath); } catch(e) {}
          resolve(outputPath);
        } catch (printErr) {
          if (win && !win.isDestroyed()) { win.close(); }
          win = null;
          try { if (tmpHtmlPath) fs.unlinkSync(tmpHtmlPath); } catch(e) {}
          reject(printErr);
        }
      });

      win.webContents.on("did-fail-load", (e, code, desc) => {
        if (win && !win.isDestroyed()) { win.close(); }
        win = null;
        try { if (tmpHtmlPath) fs.unlinkSync(tmpHtmlPath); } catch(e) {}
        reject(new Error(`Failed to load invoice HTML: ${desc}`));
      });

    } catch (err) {
      if (win) { try { win.close(); } catch(e) {} }
      try { if (tmpHtmlPath) fs.unlinkSync(tmpHtmlPath); } catch(e) {}
      reject(err);
    }
  });
}

async function mergeWithAttachments(invoicePath, pdfAttachmentPaths, outputPath) {
  let PDFLibDoc;
  try {
    PDFLibDoc = require("pdf-lib").PDFDocument;
  } catch (e) {
    console.error("pdf-lib not available for merge, copying invoice only:", e.message);
    fs.copyFileSync(invoicePath, outputPath);
    return outputPath;
  }

  const mergedDoc = await PDFLibDoc.create();

  const invoiceBytes = fs.readFileSync(invoicePath);
  const invoicePdf = await PDFLibDoc.load(invoiceBytes);
  const invoicePages = await mergedDoc.copyPages(invoicePdf, invoicePdf.getPageIndices());
  invoicePages.forEach(p => mergedDoc.addPage(p));

  for (const attPath of pdfAttachmentPaths) {
    if (!fs.existsSync(attPath)) continue;
    try {
      const attBytes = fs.readFileSync(attPath);
      const attPdf = await PDFLibDoc.load(attBytes, { ignoreEncryption: true });
      const attPages = await mergedDoc.copyPages(attPdf, attPdf.getPageIndices());
      attPages.forEach(p => mergedDoc.addPage(p));
    } catch (e) {
      console.error(`Failed to merge PDF ${attPath}:`, e.message);
    }
  }

  const mergedBytes = await mergedDoc.save();
  fs.writeFileSync(outputPath, mergedBytes);
  return outputPath;
}

module.exports = { generateInvoice, mergeWithAttachments };
