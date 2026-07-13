<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GreenMap</title>
    <script>
        (() => {
            const savedTheme = localStorage.getItem('greenmap-theme');
            const theme = savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.dataset.theme = theme;
        })();
    </script>
    <link rel="icon" type="image/png" href="assets/greenmap-icon-64.png">
    <link rel="apple-touch-icon" href="assets/greenmap-icon-192.png">
    <link rel="stylesheet" href="style.css?v=3">
    <link rel="stylesheet" href="pages/app-styles.css?v=6">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head>
<body>
    <div class="app-shell">
        <aside class="sidebar">
            <div class="brand">
                <span class="brand-mark">
                    <img src="assets/greenmap-icon.png" alt="">
                </span>
                <div>
                    <h1>GreenMap</h1>
                    <small>Pasig tree inventory</small>
                </div>
            </div>

            <button class="menu-toggle" aria-label="Toggle menu">Menu</button>
            <nav aria-label="Primary">
                <ul class="menu">
                    <li data-page="dashboard" class="active">Dashboard</li>
                    <li data-page="map">Map</li>
                    <li data-page="contributions" class="hidden" data-admin-only>My Contributions</li>
                    <li data-page="review-contributions" class="hidden" data-superadmin-only>Review Contributions</li>
                    <li data-page="manage-admins" class="hidden" data-superadmin-only>Manage Admins</li>
                    <li data-page="settings" class="hidden" data-admin-only>Settings</li>
                </ul>
            </nav>

            <div class="sidebar-footer">
                <button class="theme-toggle" id="theme-toggle" type="button" aria-pressed="false">
                    <span class="theme-toggle-icon" aria-hidden="true">&#9790;</span>
                    <span class="theme-toggle-label">Dark mode</span>
                    <span class="theme-switch" aria-hidden="true"></span>
                </button>
            </div>
        </aside>

        <main class="main">
            <header class="topbar">
                <div class="page-heading">
                    <span>Pasig Urban Forestry</span>
                    <h2 id="page-title">Dashboard</h2>
                </div>
                <div class="topbar-actions">
                    <span id="welcome-user">Welcome, User</span>
                    <button id="login-trigger">Admin Login</button>
                    <button id="logout-button" class="hidden">Log out</button>
                    <button class="issue-btn">Report Issue</button>
                </div>
            </header>

            <section class="map-area" id="map-area" hidden>
                <div id="map"></div>

                <div class="map-search" aria-label="Search and filter trees">
                    <input type="text" id="map-species-search" placeholder="Search species">
                    <select id="map-status-filter">
                        <option value="">All Status</option>
                    </select>
                    <select id="map-location-filter">
                        <option value="">All Barangays</option>
                    </select>
                </div>

                <div class="map-left-stack">
                    <div class="map-legend" aria-label="Map legend">
                        <span><i class="legend-line city"></i>Pasig City</span>
                        <span><i class="legend-line barangay"></i>Barangays</span>
                        <span><i class="legend-dot tree"></i>Trees</span>
                        <span><i class="legend-dot location"></i>My Location</span>
                    </div>

                    <aside class="tree-popup hidden">
                        <img id="tree-img" src="trees/mango.jpg" alt="Tree">
                        <div class="info">
                            <h3 id="tree-name">Tree Details</h3>
                            <p id="tree-species">Species: -</p>
                            <p id="tree-status">Status: -</p>
                            <p id="tree-location">Barangay: -</p>
                            <p id="tree-planted">Planted: -</p>
                            <p id="tree-addedby">Added by: -</p>
                            <button id="close-tree-popup" type="button">Close</button>
                        </div>
                    </aside>
                </div>

                <div class="gps-status">
                    <button id="gps-button">GPS: Locate me</button>
                </div>
            </section>

            <section id="panel" class="panel"><p>Loading dashboard...</p></section>
        </main>
    </div>

    <div id="toast" class="toast hidden" role="status"></div>

    <dialog id="issue-dialog">
        <form id="issue-form">
            <h2>Report Issue</h2>
            <label>
                Issue type
                <select id="issue-type" required>
                    <option value="">Choose one</option>
                    <option>Incorrect tree information</option>
                    <option>Map or GPS problem</option>
                    <option>Broken feature</option>
                    <option>Other</option>
                </select>
            </label>
            <label>
                Details
                <textarea id="issue-details" rows="5" maxlength="500" required></textarea>
            </label>
            <div class="dialog-actions">
                <button type="button" id="cancel-issue">Cancel</button>
                <button type="submit">Save Report</button>
            </div>
            <small>Issue reports are saved to the GreenMap database.</small>
        </form>
    </dialog>

    <dialog id="login-dialog">       
        <form id="login-form">
            <h2>Log in</h2>
            <label>
                Email
                <input type="email" name="email" required>
            </label>
            <label>
                Password
                <input type="password" name="password" required>
            </label>
            <div class="dialog-actions">
                <button type="button" id="cancel-login">Cancel</button>
                <button type="submit">Log in</button>
            </div>
        </form>
    </dialog>

    <script>
        window.GREENMAP_CONFIG = {
            pageExtension: 'html',
            apiBaseUrl: 'backend/server/api/'
        };
    </script>
    <script src="app.js?v=13"></script>
</body>
</html>
