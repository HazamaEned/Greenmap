<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GreenMap</title>
    <link rel="icon" type="image/png" href="assets/greenmap-icon-64.png">
    <link rel="apple-touch-icon" href="assets/greenmap-icon-192.png">
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="pages/app-styles.css">
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
                    <li data-page="dashboard">Dashboard</li>
                    <li data-page="map" class="active">Map</li>
                    <li data-page="add-tree">Add Tree</li>
                    <li data-page="contributions">My Contributions</li>
                    <li data-page="settings">Settings</li>
                </ul>
            </nav>
        </aside>

        <main class="main">
            <header class="topbar">
                <div class="page-heading">
                    <span>Pasig Urban Forestry</span>
                    <h2 id="page-title">Map</h2>
                </div>
                <div class="topbar-actions">
                    <span id="welcome-user">Welcome, User</span>
                    <button class="issue-btn">Report Issue</button>
                </div>
            </header>

            <section class="map-area" id="map-area">
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

                <div class="gps-status">
                    <button id="gps-button">GPS: Locate me</button>
                </div>
            </section>

            <section id="panel" class="panel hidden"></section>
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
            <small>Saved on this device until the database is connected.</small>
        </form>
    </dialog>

    <script>
        window.GREENMAP_CONFIG = {
            pageExtension: 'html',
            apiBaseUrl: 'api/'
        };
    </script>
    <script src="app.js?v=2"></script>
</body>
</html>