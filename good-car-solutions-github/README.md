# Good Car Solutions

A full-stack desktop + mobile business management app built for automotive ECU programming and vehicle electrical services. Electron desktop app with a self-hosted Node.js server and mobile PWA — built from scratch in 12 days.

> **Built for [Good Car Solutions](https://goodcarsolutions.com) · Houston, TX**

---

## Features

### Core Business Management
- **Work Orders** — Full job lifecycle: scheduling, in-route, in-progress, completed. Track VIN, ECU/module type, tools used, status, priority, and payment
- **Customer CRM** — Manage shops, dealers, body shops, and fleet accounts with contact info, revenue tracking, and job history
- **Estimates** — Create estimates linked to clients with searchable picker, convert to work orders with one tap
- **Invoice Generation** — PDF invoices with embedded photos/PDFs, multi-service line items, email delivery, Stripe payment links, and locked invoice numbers per job
- **Compliance** — E-signature agreements for customer sign-off

### Operations
- **Route Map** — Interactive Leaflet map with OSRM routing between job sites, Google Maps navigation per stop, day-based scheduling
- **Calendar** — Day/week/month views with job scheduling
- **Teams** — Multi-user team management with job assignment and real-time notifications
- **Dashboard** — Revenue analytics, active jobs, status overview

### Reference
- **Knowledge Base** — Store procedures, DTC maps, and calibration file references with tags
- **Vehicle Database** — Searchable reference for ECU platforms, modules, engines, and protocols

### Infrastructure
- **Desktop App** — Electron-based Windows app with offline local mode
- **Server Mode** — Self-hosted Express/SQLite server with JWT auth, role-based access, real-time sync
- **Mobile PWA** — Full-featured Progressive Web App with complete desktop parity
- **Public Intake Form** — Embeddable client request form for your website
- **File Management** — Photo/document upload, preview, and timeline attachments
- **Email Integration** — SMTP-based invoice delivery with branded HTML templates
- **Stripe Integration** — Payment links with tracking and status badges

---

## Architecture

```
┌──────────────────────────────┐
│   Electron Desktop App       │  ← Windows .exe (local or server mode)
│   (React, single HTML file)  │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│   Node.js / Express Server   │  ← Self-hosted, JWT auth, SQLite
│   (server/server.js)         │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│   Mobile PWA                 │  ← server/mobile/index.html
│   (Vanilla JS, responsive)   │
└──────────────────────────────┘
```

- **Desktop**: Electron + React (bundled in `src/index.html`) with IPC bridge (`preload.js`)
- **Server**: Express.js + sql.js (SQLite in-memory with WAL persistence) — `server/server.js`
- **Mobile**: Vanilla JS PWA served by the Express server — `server/mobile/index.html`
- **Invoices**: HTML → Chromium printToPDF with pdf-lib for attachment merging — `invoice-generator.js`

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org) (v18+ LTS)

### Option 1: Desktop App (Local Mode)
```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/good-car-solutions.git
cd good-car-solutions

# Install dependencies
npm install

# Run in development
npx electron .

# Or build a Windows installer
BUILD.bat
```

### Option 2: Server + Mobile
```bash
# Start the server
cd server
npm install
node server.js
# Server runs on http://localhost:3141
# Mobile PWA at http://localhost:3141/mobile
# Default admin: admin / admin123
```

### Option 3: Windows Build Scripts
| File | Description |
|------|-------------|
| `BUILD.bat` | Creates a Windows installer (.exe) with desktop shortcut |
| `BUILD-PORTABLE.bat` | Creates a single portable .exe |
| `LAUNCH.bat` | Quick-launch for development |
| `server/START-SERVER.bat` | One-click server startup |

---

## Project Structure

```
good-car-solutions/
├── main.js                  # Electron main process + IPC handlers
├── preload.js               # Context bridge (renderer ↔ main)
├── invoice-generator.js     # HTML→PDF invoice engine
├── server-client.js         # Desktop→Server API client
├── package.json             # Electron + build config
├── src/
│   ├── index.html           # Full React UI (single-file app)
│   ├── logo.png             # Company logo
│   ├── banner.png           # Login banner
│   └── icon.ico             # App icon
├── server/
│   ├── server.js            # Express API + SQLite + auth
│   ├── db.js                # Database initialization
│   ├── migrate.js           # Schema migrations
│   ├── package.json         # Server dependencies
│   ├── START-SERVER.bat     # Windows quick-start
│   └── mobile/
│       ├── index.html       # Full mobile PWA (single-file app)
│       ├── manifest.json    # PWA manifest
│       └── icon-*.png       # PWA icons
├── BUILD.bat                # Windows installer build
├── BUILD-PORTABLE.bat       # Portable exe build
├── LAUNCH.bat               # Dev launcher
├── LICENSE
└── README.md
```

---

## Data Storage

**Local Mode:** `C:\ProgramData\GoodCarSolutions\gcs-data.json`

**Server Mode:** SQLite database at `server/data/gcs.db` with file uploads in `server/uploads/`

### Backup & Restore
- **Desktop**: Settings → Export/Import All Data
- **Server**: Database auto-persists, copy `server/data/` for backups

---

## Configuration

### Server Environment
The server reads settings from the database (configurable via desktop Settings page):
- **SMTP** — Host, port, user, pass for invoice emails
- **Stripe** — API key for payment links
- **Company Info** — Name, address, phone for invoices

### Exposing to Internet
For mobile access outside your local network, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/):
```bash
cloudflared tunnel --url http://localhost:3141
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | Feb 14 | Desktop app launch — Work Orders, CRM, Knowledge Base, Vehicle Database, Dashboard |
| v1.2–v1.4 | Feb 16 | Customer/job enhancements, invoice generation system |
| v1.5.0 | Feb 17 | Self-hosted server mode — Express/SQLite, JWT auth, role-based access |
| v1.5.1 | Feb 17 | Stripe payment links, team management, server-synced file attachments |
| v1.6–v1.8 | Feb 17 | Status badges, email invoices, map filtering, vehicle history, mobile PWA launch |
| v1.9 | Feb 18 | Stable data location, editable timeline entries |
| v2.0.0 | Feb 18 | Estimates, Compliance with e-signatures, Service Map |
| v2.1.0 | Feb 18 | Mobile invoice creation, render system rewrite |
| v2.2.0 | Feb 18 | Mobile client creation, build fixes |
| v2.3.0 | Feb 19 | Calendar/map home, teams management, notifications, public intake form |
| v2.3.2–v2.3.3 | Feb 19–24 | Calendar fixes, mobile customer picker, order flow preservation |
| v2.4.0 | Feb 24 | Full mobile/desktop feature parity — 6 views added, navigation restructured |
| v2.4.1–v2.4.6 | Feb 24 | Mobile editing, payments, delete orders, team assignment, job type sync |
| v2.5.0 | Feb 25 | Photos & PDFs in invoices, multi-service line items per job |
| v2.5.1–v2.5.4 | Feb 25 | Invoice stability fixes, Save Draft button |
| v2.6.0 | Feb 25 | Route map with OSRM navigation, estimates linked to clients |
| v2.6.1 | Feb 25 | Invoice crash fix, estimates client display |
| v2.6.2 | Feb 25 | Image compression for email-ready PDFs |
| v2.6.3 | Feb 25 | EXIF orientation fix, vehicle in filenames & email subjects |
| v2.6.4 | Feb 25 | Locked invoice numbers per job |

---

## Tech Stack

- **Desktop**: Electron, React (no build step — single HTML file)
- **Server**: Node.js, Express, sql.js (SQLite), JWT, bcrypt
- **Mobile**: Vanilla JS PWA, Leaflet maps, OSRM routing
- **Invoices**: Chromium printToPDF, pdf-lib, EXIF orientation parsing
- **Payments**: Stripe API
- **Email**: Nodemailer + SMTP
- **Maps**: OpenStreetMap tiles, Nominatim geocoding, OSRM routing

---

## License

MIT — see [LICENSE](LICENSE)

---

**Good Car Solutions** — Vehicle Electrical & Programming Services · Houston, TX
