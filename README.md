# GreenMap

**A Web-Based Tree Locator and Trimming Scheduler System**

GreenMap is a web-based mapping system that helps Pasig City report trees that need trimming or have fallen, and schedule trimming work. Verified data is shown on a public interactive map, while submissions and approvals are handled by authenticated users.

---

## Table of Contents

- [Features](#features)
- [User Roles](#user-roles)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database](#database)
- [API Overview](#api-overview)
- [Getting Started (Local Setup)](#getting-started-local-setup)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Collaboration Workflow](#collaboration-workflow)
- [Known Limitations](#known-limitations)
- [Authors](#authors)

---

## Features

- **Interactive public map** of trees in Pasig City, viewable without logging in
- **Viewport and species filters** so the map only loads what is on screen
- **Tree submission workflow**: field users submit tree records, and approvers review them before they appear publicly
- **Tree trimming and fallen tree reporting** with scheduling of trimming work
- **Barangay boundaries overlay** for all 30 official Pasig City barangays, fetched from a government ArcGIS API and cached
- **Species search** for quick lookup when submitting or filtering
- **Role-based access** with session-based authentication

## User Roles

| Role | Description |
|------|-------------|
| **Public (unauthenticated)** | Can view the map and approved tree data |
| **`admin`** | Tree submitters who create tree records and reports |
| **`superadmin`** | Account managers and approvers who review contributions and create admin accounts |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML, CSS, JavaScript (static build hosted on Vercel) |
| Backend | PHP 8.2 with plain MySQLi (procedural style) |
| Database | MySQL / TiDB Cloud (MySQL-compatible) |
| Image storage | Cloudinary |
| Auth | PHP sessions (cookie-based) |
| Local dev | Apache via XAMPP |
| Hosting | Vercel (frontend), Render with Docker (backend), TiDB Cloud (database) |
| Boundary data | Pasig City ArcGIS API |


## API Overview

All endpoints live under `backend/server/api/`.

| Endpoint | Purpose |
|----------|---------|
| login / logout / me | Session authentication and current user |
| submission creation | Create a tree submission (wrapped in a database transaction) |
| tree list / pins | Fetch trees with viewport and species filters |
| species search | Search the species list |
| admin creation | Create `admin` accounts (superadmin only) |
| review-contributions | List and review submissions, filterable by approval status |
| boundaries | Fetch and cache Pasig barangay polygons |

## Getting Started (Local Setup)

### Prerequisites

- [XAMPP](https://www.apachefriends.org/) (Apache + PHP 8.x) or any Apache/PHP stack
- MySQL 8 (or a TiDB Cloud connection)
- Git

### Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/<your-username>/GreenMap.git
   ```
2. **Place the project** inside your web root (e.g. `C:\xampp\htdocs\GreenMap`).
3. **Create the database** and import the schema (and the seeded `barangays` data).
4. **Create your `.env` file** (see [Configuration](#configuration)).
5. **Start Apache** (and MySQL) from the XAMPP Control Panel.
6. **Open the app** at `http://localhost/GreenMap/`.

## Configuration

Create a `.env` file in the backend folder:

```env
DB_HOST=your-database-host
DB_PORT=4000
DB_USER=your-username
DB_PASS=your-password
DB_NAME=greenmap
```

`connection.php` reads real environment variables first (`getenv()`, used on Render) and falls back to `$_ENV` from the `.env` file (used on local and restricted hosts). If `.env` is missing, the loader skips it instead of stopping.

> ⚠️ Never commit your `.env` file. Add it to `.gitignore`.

**TiDB Cloud** requires SSL. The connection uses `mysqli_ssl_set()` with the `isrgrootx1.pem` CA certificate included in the repository.

## Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | Vercel | Serves the static `index.html` |
| Backend | Render | Docker image based on `php:8.2-apache` with the `mysqli` extension |
| Database | TiDB Cloud | Free tier, MySQL-compatible, SSL required |

**Cross-origin requirements** (Vercel frontend talking to the Render backend):

- Session cookies set with `SameSite=None; Secure`
- `sendCorsHeaders()` in `sessions-helper.php` echoes the origin only if it is in the allow-list and handles `OPTIONS` preflight
- Frontend `fetch` calls use `credentials: 'include'`

Add your deployed frontend URL to the CORS allow-list before deploying the backend.

## Collaboration Workflow

- Each developer runs a local XAMPP instance.
- Code is synced through GitHub. **Images and the database are not synced through Git.**
- Images are synced through **Cloudinary**, so all collaborators see the same uploaded images.
- The shared database is hosted on TiDB Cloud so all collaborators use the same data.

## Known Limitations

- Backend free-tier hosting may cold-start slowly after inactivity.
- Free hosts such as InfinityFree block outbound connections to TiDB's port 4000, which is why the backend runs on Render.
- Uploaded images are not stored in Git; they are hosted and synced through Cloudinary.

## Authors

- **Christian Benedict Juson** — Developer
- **Jan Edlan Maloto** — Developer
- **Yrvine Cholo Hiteroza** — Developer

Developed as a capstone project for Pasig City.

## License
This project is licensed under the [MIT License](LICENSE).MIT License
