# Changelog

All notable changes to Good Car Solutions.

## [2.6.4] - 2025-02-25
- Locked invoice numbers per job — assigned once, never changes on re-export
- Invoice No field shows 🔒 when locked, read-only

## [2.6.3] - 2025-02-25
- EXIF orientation fix for phone photos in invoices
- Vehicle info added to invoice filenames and email subjects

## [2.6.2] - 2025-02-25
- Image compression for email-ready PDFs (1200px max, JPEG 70%)
- Phone photos reduced from ~5-10MB to ~100-200KB each

## [2.6.1] - 2025-02-25
- Fixed invoice generation crash on null draft handling
- Fixed estimates client name display

## [2.6.0] - 2025-02-25
- Mobile route map with Leaflet + OSRM driving directions
- Estimates linked to clients with searchable picker
- Customer-from-estimate creation flow
- Self-contained invoice images (base64 embedded, zero external requests)

## [2.5.4] - 2025-02-25
- Save Draft button for invoices on desktop and mobile

## [2.5.0–2.5.3] - 2025-02-25
- Photos and PDFs embedded directly in invoice output
- Multi-service line items saved per job
- Fixed invoice generation freezes with large phone camera images
- Switched from data URLs to temp file loading for Chromium rendering

## [2.4.1–2.4.6] - 2025-02-24
- Mobile work order editing
- Payment recording with full billing UI
- Delete work order functionality
- Teams member assignment
- Job type dropdown sync between desktop and mobile

## [2.4.0] - 2025-02-24
- Full mobile/desktop feature parity — 6 missing mobile views added
- Navigation restructured to 4 main tabs + More menu

## [2.3.2–2.3.3] - 2025-02-19 to 2025-02-24
- Calendar fixes and mobile customer picker
- Order flow preservation during navigation

## [2.3.0] - 2025-02-19
- Calendar/map home page
- Teams management with job assignment
- Real-time notifications
- Public client intake form

## [2.2.0] - 2025-02-18
- Mobile client creation form with render-lock protection
- Build and deployment fixes

## [2.1.0] - 2025-02-18
- Mobile invoice creation with server-side HTML generation
- Complete render system rewrite with view-level locking

## [2.0.0] - 2025-02-18
- Estimates page with create, edit, convert to work order
- Compliance page with e-signature agreements
- Service Map with configurable home base
- Mobile estimates and new job creation
- Customer address editing from mobile

## [1.9] - 2025-02-18
- Stable data location (C:\ProgramData\GoodCarSolutions)
- Editable timeline entries

## [1.6–1.8] - 2025-02-17
- Payment-aware status badges
- Email invoice delivery via SMTP
- Map filtering with OSRM routing
- Vehicle history auto-population
- Mobile PWA launch with file upload/preview
- Desktop file preview overlay

## [1.5.1] - 2025-02-17
- Stripe payment links
- Team management
- Server-synced file attachments

## [1.5.0] - 2025-02-17
- Self-hosted server mode with Express/SQLite
- JWT authentication with role-based access
- User management (admin/tech roles)
- Real-time sync between desktop and server
- Login screen and connection status indicator

## [1.2–1.4] - 2025-02-16
- Customer and job enhancements
- Invoice generation system

## [1.0] - 2025-02-14
- Initial release
- Work Orders, Customer CRM, Knowledge Base, Vehicle Database
- Dashboard with analytics
- Settings with data export/import
- Electron desktop app for Windows
