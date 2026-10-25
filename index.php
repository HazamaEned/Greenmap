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
    <link rel="stylesheet" href="style.css?v=19">
    <link rel="stylesheet" href="pages/app-styles.css?v=15">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        /* Floating label styles for login form */
        .field {
            position: relative;
        }
        .field .field-label {
            position: absolute;
            left: 12px;
            top: 14px;
            color: var(--muted-more);
            pointer-events: none;
            transition: all 0.2s ease-out;
            background-color: var(--surface);
            padding: 0 4px;
        }
        .field.has-content .field-label,
        .field input:focus + .field-label {
            top: -10px;
            left: 8px;
            font-size: 0.8rem;
            color: var(--primary);
        }

        /* Autofill detection: a simple animation on autofilled inputs */
        @keyframes on-autofill-start { from {} to {} }

        /* The browser applies its own styles, but we can still trigger our animation */
        input:-webkit-autofill {
            animation-name: on-autofill-start;
            animation-fill-mode: both;
        }

        /* Style for destructive action buttons in dialogs */
        .danger-action {
            background-color: var(--danger, #d9534f);
            color: white;
        }
        .danger-action:hover, .danger-action:focus {
            background-color: var(--danger-hover, #c9302c);
            border-color: transparent;
        }
    </style>
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
                    <small>Pasig Tree Inventory</small>
                </div>
            </div>

            <button class="menu-toggle" aria-label="Toggle menu">Menu</button>
            <nav aria-label="Primary">
                <ul class="menu">
                    <li data-page="map" class="active">Map</li>
                    <li data-page="dashboard">Dashboard</li>
                    <li data-page="add-tree">Report a Tree</li>
                    <li data-page="contributions" class="hidden" data-admin-only>My Reports</li>
                    <li data-page="account" class="hidden" data-admin-only>Account</li>
                    <li data-page="review-contributions" class="hidden" data-superadmin-only>Review Reports</li>
                    <li data-page="manage-admins" class="hidden" data-superadmin-only>Manage Admins</li>
                    <li data-page="reports" class="hidden" data-superadmin-only>Issue Reports</li>
                </ul>
            </nav>

            <div class="sidebar-footer">
                <div class="drawer-user" id="drawer-user">
                    <div class="drawer-user-info">
                        <span class="drawer-avatar-badge" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        </span>
                        <div class="drawer-user-meta">
                            <strong class="drawer-user-name user-name-display">Guest</strong>
                            <span class="drawer-user-role user-role-badge">Public Access</span>
                        </div>
                    </div>
                    <button id="drawer-login-trigger" class="drawer-auth-btn login-btn" type="button">Login</button>
                    <button id="drawer-logout-button" class="drawer-auth-btn logout-btn hidden" type="button" title="Log out">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3"></path>
                            <polyline points="10 11 13 8 10 5"></polyline>
                            <line x1="13" y1="8" x2="5" y2="8"></line>
                        </svg>
                        <span>Log out</span>
                    </button>
                </div>
                <button class="theme-toggle" id="theme-toggle" type="button" aria-pressed="false">
                    <span class="theme-toggle-icon" aria-hidden="true">&#9790;</span>
                    <span class="theme-toggle-label">Dark mode</span>
                    <span class="theme-switch" aria-hidden="true"></span>
                </button>
                <div class="sidebar-agency">
                    <span>Pasig City Government</span>
                    <small>GreenMap v2.0 &mdash; CENRO Operations</small>
                </div>
            </div>
        </aside>

        <main class="main">
            <header class="topbar">
                <div class="page-heading">
                    <span>Pasig CENRO</span>
                    <h2 id="page-title">Map</h2>
                </div>
                <div class="topbar-actions">
                    <div class="topbar-user" id="topbar-user">
                        <div class="topbar-user-info hidden" id="topbar-user-info">
                            <span class="user-avatar-badge" aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                </svg>
                            </span>
                            <div class="topbar-user-meta">
                                <strong class="user-name-display" id="welcome-user">Guest</strong>
                                <span class="user-role-badge" id="user-role-label">Public Access</span>
                            </div>
                        </div>
                        <button id="login-trigger" class="auth-btn login-btn" type="button">Admin Login</button>
                        <button id="logout-button" class="auth-btn logout-btn hidden" type="button" title="Log out">
                            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3"></path>
                                <polyline points="10 11 13 8 10 5"></polyline>
                                <line x1="13" y1="8" x2="5" y2="8"></line>
                            </svg>
                            <span>Log out</span>
                        </button>
                    </div>
                    <button class="issue-btn" type="button">Report Issue</button>
                </div>
            </header>

            <section class="map-area" id="map-area">
                <div id="map"></div>

                <div class="map-search" id="map-search" aria-label="Search and filter trees">
                    <div class="map-search-inputs" id="map-search-inputs">
                        <input type="text" id="map-species-search" placeholder="Search species">
                        <select id="map-status-filter">
                            <option value="">All Actions</option>
                            <option value="Trim">✂️ Trim</option>
                            <option value="Move">🚛 Move</option>
                            <option value="Remove">🪓 Remove</option>
                            <option value="Completed">✅ Completed</option>
                        </select>
                        <select id="map-location-filter">
                            <option value="">All Barangays</option>
                        </select>
                    </div>
                    <button type="button" class="map-search-toggle" id="map-search-toggle" aria-expanded="false" aria-label="Toggle search and filters" title="Search and filters">
                        <svg class="search-icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <circle cx="11" cy="11" r="7"></circle>
                            <line x1="21" y1="21" x2="16.5" y2="16.5"></line>
                        </svg>
                        <svg class="close-icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div class="map-left-stack">
                    <div class="map-legend" aria-label="Map legend">
                        <span title="Pasig City"><i class="legend-line city"></i><span class="legend-label">Pasig City</span></span>
                        <span title="Barangays"><i class="legend-line barangay"></i><span class="legend-label">Barangays</span></span>
                        <span title="Trees"><i class="legend-emoji" aria-hidden="true">&#127794;</i><span class="legend-label">Trees</span></span>
                        <span title="My Location"><i class="legend-emoji" aria-hidden="true">&#128205;</i><span class="legend-label">My Location</span></span>
                    </div>

                    <aside class="tree-popup hidden">
                        <button id="tree-photo-trigger" class="tree-photo-trigger" type="button" aria-label="View tree photo fullscreen">
                            <img id="tree-img" src="trees/mango.jpg" alt="Tree">
                        </button>
                        <div class="info">
                            <h3 id="tree-name">Tree Action Report</h3>
                            <p id="tree-action"><span class="action-badge">–</span></p>
                            <p id="tree-priority">Priority: –</p>
                            <p id="tree-status">Condition: –</p>
                            <p id="tree-location">Barangay: –</p>
                            <p id="tree-area">Area: –</p>
                            <p id="tree-address">Address: –</p>
                            <p id="tree-reason">Reason: –</p>
                            <p id="tree-denial-reason" class="hidden" style="color: #9f1239; background: #fff1f2; border: 1px solid #fecdd3; border-left: 3px solid #e11d48; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem; margin: 8px 0; word-break: break-word;">
                                <strong>Denial Reason:</strong> <span id="tree-denial-reason-text"></span>
                            </p>
                            <p id="tree-addedby">Reported by: –</p>
                            <div class="tree-popup-actions">
                                <a id="view-streetview" class="primary" href="https://www.instantstreetview.com/" target="_blank" rel="noopener noreferrer">Street View</a>
                                <button id="resubmit-tree-btn" class="resubmit-btn hidden" type="button">Resubmit Entry</button>
                                <button id="close-tree-popup" type="button">Close</button>
                            </div>
                        </div>
                    </aside>
                </div>

                <div class="gps-status">
                    <button id="gps-button">GPS: Locate me</button>
                </div>
            </section>

            <section id="panel" class="panel hidden"><p>Loading...</p></section>
        </main>
    </div>

    <div id="toast" class="toast hidden" role="status"></div>

    <dialog id="photo-viewer-dialog" aria-label="Fullscreen tree photo">
        <div class="photo-viewer-content">
            <img id="fullscreen-tree-img" alt="">
            <button id="close-photo-viewer" type="button" aria-label="Exit fullscreen photo">&times;</button>
        </div>
    </dialog>

    <dialog id="resubmit-dialog">
        <form id="resubmit-form" class="dialog-view" style="max-width: 440px;">
            <h2>Resubmit Tree Action</h2>
            <p id="resubmit-tree-info" style="color: var(--muted); margin: -8px 0 12px; font-size: 0.9rem;"></p>
            <input type="hidden" name="tree_id" id="resubmit-tree-id">
            <input type="hidden" name="latitude" id="resubmit-latitude">
            <input type="hidden" name="longitude" id="resubmit-longitude">
            <input type="hidden" name="address" id="resubmit-address">
            <input type="hidden" name="area_type" id="resubmit-area-type">

            <label class="field">
                <span>Action Type</span>
                <select name="action_type" id="resubmit-action-type" required>
                    <option value="Trim">✂️ Trim</option>
                    <option value="Remove">🪓 Remove</option>
                    <option value="Move" id="resubmit-move-option">🚛 Move</option>
                </select>
            </label>

            <label class="field">
                <span>Priority</span>
                <select name="priority" id="resubmit-priority" required>
                    <option value="Low">Low</option>
                    <option value="Moderate" selected>Moderate</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                </select>
            </label>

            <label class="field">
                <span>Reason for Action</span>
                <textarea name="reason" id="resubmit-reason" rows="3" maxlength="1000" placeholder="e.g. Tree branches require trimming again..." required></textarea>
            </label>

            <div id="resubmit-guest-fields" class="hidden">
                <label class="field">
                    <span>Your Name (Optional)</span>
                    <input type="text" name="reporter_name" id="resubmit-reporter-name" placeholder="Full name">
                </label>
                <label class="field">
                    <span>Contact Info (Optional)</span>
                    <input type="text" name="reporter_contact" id="resubmit-reporter-contact" placeholder="Mobile or email">
                </label>
            </div>

            <label class="field">
                <span>New Photo (Optional)</span>
                <input type="file" name="tree_photo" id="resubmit-photo-input" accept="image/jpeg,image/png,image/webp">
            </label>

            <div class="dialog-actions">
                <button type="button" id="cancel-resubmit">Cancel</button>
                <button type="submit" class="primary-action">Submit Request</button>
            </div>
            <small style="color: var(--muted); font-size: 11px;">The new action request will be submitted for superadmin review.</small>
        </form>
    </dialog>

    <dialog id="submission-success-dialog">
        <div class="dialog-view" style="text-align: center; gap: 20px;">
            <h2>Entry Submitted</h2>
            <p style="color: var(--muted); margin: -10px 0 0;">Wait for an admin to verify.</p>
            <div class="dialog-actions" style="justify-content: center;">
                <button type="button" id="close-submission-success" class="primary-action">OK</button>
            </div>
        </div>
    </dialog>

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
        <form id="login-form" class="dialog-view">
            <div class="brand" style="justify-content: center; margin-bottom: 20px; text-align: center;">
                <span class="brand-mark" style="margin-right: 12px;">
                    <img src="assets/greenmap-icon.png" alt="GreenMap logo">
                </span>
                <div>
                    <h1 style="font-size: 1.75rem;">GreenMap</h1>
                </div>
            </div>
            <label class="field">
                <input type="email" name="email" required autocomplete="email" placeholder=" ">
                <span class="field-label">Email</span>
            </label>
            <label class="field">
                <input type="password" name="password" required autocomplete="current-password" placeholder=" ">
                <span class="field-label">Password</span>
            </label>
            <div class="dialog-actions">
                <button type="button" id="cancel-login">Cancel</button>
                <button type="submit" class="primary-action">Log in</button>
            </div>
        </form>
    </dialog>

    <dialog id="confirm-dialog">
        <div class="dialog-view">
            <h2 id="confirm-dialog-title">Confirm Action</h2>
            <p id="confirm-dialog-message" style="margin-top: 0; max-width: 400px;"></p>
            <div class="dialog-actions">
                <button type="button" id="confirm-dialog-cancel">Cancel</button>
                <button type="button" id="confirm-dialog-confirm" class="danger-action">Confirm</button>
            </div>
        </div>
    </dialog>

    <dialog id="deny-dialog">
        <form id="deny-dialog-form" class="dialog-view" method="dialog">
            <h2 id="deny-dialog-title" style="margin-top: 0;">Deny Report</h2>
            <p id="deny-dialog-message" style="margin-top: 0; max-width: 440px; color: var(--text-muted); font-size: 0.95rem; line-height: 1.4;">
                Please provide a reason why this report is being denied. This reason will be visible to the submitting administrator in their My Reports page.
            </p>
            <label class="field" style="margin-top: 12px; display: block;">
                <span style="display: block; font-weight: 600; margin-bottom: 6px;">Denial Reason <span style="color: var(--red);">*</span></span>
                <textarea id="deny-dialog-reason" rows="4" maxlength="500" placeholder="State clearly why this report is denied..." required style="width: 100%; box-sizing: border-box;"></textarea>
            </label>
            <p id="deny-dialog-error" style="color: var(--red); font-size: 0.85rem; margin: 6px 0 0; display: none;"></p>
            <div class="dialog-actions" style="margin-top: 16px;">
                <button type="button" id="deny-dialog-cancel">Cancel</button>
                <button type="submit" id="deny-dialog-confirm" class="danger-action">Confirm Denial</button>
            </div>
        </form>
    </dialog>

    <script>
        window.GREENMAP_CONFIG = {
            pageExtension: 'html',
            apiBaseUrl: 'backend/server/api/'
        };
    </script>
    <script>
        // Handle dynamic placeholders for login form
        // This robustly handles browser autofill behavior for floating labels.
        document.addEventListener('DOMContentLoaded', () => {
            const loginForm = document.getElementById('login-form');
            if (!loginForm) return;

            const inputs = loginForm.querySelectorAll('input[name="email"], input[name="password"]');

            const checkValue = (field) => {
                const input = field.querySelector('input');
                field.classList.toggle('has-content', input.value.length > 0);
            };

            loginForm.querySelectorAll('.field').forEach(field => {
                const input = field.querySelector('input');
                checkValue(field); // Check on load
                input.addEventListener('input', () => checkValue(field));
                input.addEventListener('animationstart', (e) => {
                    if (e.animationName === 'on-autofill-start') {
                        checkValue(input);
                    }
                });
            });
        });
    </script>
    <script src="app.js?v=27"></script>
</body>
</html>
