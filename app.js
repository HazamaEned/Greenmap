(async () => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const escapeHtml = value => {
        if (value === null || value === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    };
    const config = window.GREENMAP_CONFIG || {};
    const pageExtension = config.pageExtension || 'html';
    const apiBaseUrl = config.apiBaseUrl || 'backend/server/api/';
    const pageTitles = {
        dashboard: 'Dashboard',
        map: 'Map',
        'add-tree': 'Report a Tree',
        contributions: 'My Reports',
        'review-contributions': 'Review Reports',
        'manage-admins': 'Manage Admins',
        'edit-admin': 'Edit Admin',
        'account': 'My Account',
        'report-issue': 'Report Issue',
        'report-details': 'Report Details'
    };
    pageTitles['reports'] = 'Issue Reports';

    const ACTION_TYPES = Object.freeze(['Trim', 'Move', 'Remove']);
    const PRIORITY_LEVELS = Object.freeze(['Urgent', 'High', 'Moderate', 'Low']);

    // Color palette per action type
    const ACTION_COLORS = Object.freeze({
        Trim:   '#d97706',  // amber
        Move:   '#2563eb',  // blue
        Remove: '#dc2626',  // red
    });
    const PASIG_BARANGAYS = Object.freeze([
        'Bagong Ilog',
        'Bagong Katipunan',
        'Bambang',
        'Buting',
        'Caniogan',
        'Dela Paz',
        'Kalawaan',
        'Kapasigan',
        'Kapitolyo',
        'Malinao',
        'Manggahan',
        'Maybunga',
        'Oranbo',
        'Palatiw',
        'Pinagbuhatan',
        'Pineda',
        'Rosario',
        'Sagad',
        'San Antonio',
        'San Joaquin',
        'San Jose',
        'San Miguel',
        'San Nicolas',
        'Santa Cruz',
        'Santa Lucia',
        'Santa Rosa',
        'Santo Tomas',
        'Santolan',
        'Sumilang',
        'Ugong'
    ]);

    let map;
    let treeLayer;
    let boundaryLayer;
    let userMarker;
    let pendingLocationMarker = null;
    let startupLocationRequested = false;
    let databaseTrees = [];
    let databaseContributions = [];
    let speciesList = [];
    let pendingLocation = null;
    let currentUser = null; // { name, role } or null if not logged in
    let locationSource = 'Not requested';
    let userInsidePasig = null; // null = unknown, true = inside, false = outside
    let selectedTreePhotoUrl = '';
    let selectedTreeForResubmit = null;
    let activeCameraStream = null;

    function resolvePhotoUrl(photo) {
        if (!photo) return '';
        if (photo.startsWith('http://') || photo.startsWith('https://') || photo.startsWith('data:') || photo.startsWith('blob:')) {
            return photo;
        }
        const cleanPath = photo.replace(/^\/+/, '');
        if (apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://')) {
            const rootUrl = apiBaseUrl.replace(/backend\/server\/api\/?$/, '');
            return `${rootUrl}${cleanPath}`;
        }
        return cleanPath;
    }
    let dashboardBarangayFilter = '';
    let currentPageState = {};

    // Boundary data is loaded before the dashboard so filters work even if
    // the user has not opened the map yet.
    let barangayPolygons = [];
    let boundaryData = null;
    let boundaryDataPromise = null;

    // tree id -> { marker, tree } so the filter can dim/restore markers
    // without re-fetching or re-building them.
    let treeMarkers = new Map();

    const ACTION_ICON_EMOJI = Object.freeze({ Trim: '✂️', Move: '🚛', Remove: '🪓', Completed: '✅', Pending: '❓' });
    const ACTION_ICON_CLASS = Object.freeze({ Trim: 'marker-trim', Move: 'marker-move', Remove: 'marker-remove', Completed: 'marker-completed', Pending: 'marker-pending' });

    const treeIcon = (actionType = '', isPending = false) => {
        const emoji = isPending ? '❓' : (ACTION_ICON_EMOJI[actionType] || '🌿');
        const cls   = isPending ? 'marker-pending' : (ACTION_ICON_CLASS[actionType] || 'marker-unknown');
        return L.divIcon({
            className: `greenmap-marker greenmap-tree-marker ${cls}`,
            html: `<span aria-hidden="true">${emoji}</span>`,
            iconSize:    [36, 36],
            iconAnchor:  [18, 32],
            popupAnchor: [0, -30]
        });
    };

    const userIcon = () => L.divIcon({
        className: 'greenmap-marker greenmap-user-marker',
        html: '<span aria-hidden="true">&#128205;</span>',
        iconSize: [36, 36],
        iconAnchor: [18, 34],
        popupAnchor: [0, -32]
    });

    const trees = () => databaseTrees;
    const isLoggedIn = () => currentUser !== null;
    const canSubmitTrees = () => currentUser?.role === 'admin' || currentUser?.role === 'superadmin';
    const isAdmin = () => canSubmitTrees();
    const isSuperadmin = () => currentUser?.role === 'superadmin';

    function toast(message) {
        const element = $('#toast');
        element.textContent = message;
        element.classList.remove('hidden');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => element.classList.add('hidden'), 3000);
    }

    function showOutsidePasigWarning(message = 'You are not inside of Pasig City') {
        const existing = $('#outside-pasig-warning');
        if (existing) {
            clearTimeout(existing._hideTimer);
            existing.remove();
        }

        const warning = document.createElement('div');
        warning.id = 'outside-pasig-warning';
        warning.className = 'outside-pasig-warning';
        warning.setAttribute('role', 'alert');
        warning.innerHTML = `
            <span class="outside-pasig-icon" aria-hidden="true">&#9888;</span>
            <span>${escapeHtml(message)}</span>
        `;

        document.body.appendChild(warning);

        // Trigger fade-in on next frame
        requestAnimationFrame(() => warning.classList.add('outside-pasig-warning--visible'));

        warning._hideTimer = setTimeout(() => {
            warning.classList.remove('outside-pasig-warning--visible');
            warning.addEventListener('transitionend', () => warning.remove(), { once: true });
        }, 5000);
    }

    function showMapNotification(title, message) {
        if (!map) return;

        // Remove any existing notification
        const existing = $('.map-notification');
        if (existing) {
            clearTimeout(existing.timer);
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.className = 'map-notification';
        notification.innerHTML = `
            <div class="map-notification-content">
                <h2>${escapeHtml(title)}</h2>
                <p>${escapeHtml(message)}</p>
            </div>
            <button class="map-notification-close" aria-label="Close notification">&times;</button>
        `;

        const close = () => {
            clearTimeout(notification.timer);
            notification.remove();
        };

        notification.querySelector('.map-notification-close').onclick = close;
        notification.timer = setTimeout(close, 2500);

        map.getContainer().appendChild(notification);
    }

    /**
     * Shows a custom, styled confirmation dialog.
     * @param {string} message The confirmation message to display.
     * @param {string} [title='Confirm Action'] The title for the dialog.
     * @returns {Promise<boolean>} A promise that resolves to true if confirmed, false otherwise.
     */
    function showConfirmationDialog(message, title = 'Confirm Action') {
        const dialog = $('#confirm-dialog');
        if (!dialog) return Promise.resolve(confirm(message)); // Fallback to native confirm

        $('#confirm-dialog-title', dialog).textContent = title;
        $('#confirm-dialog-message', dialog).textContent = message;

        dialog.showModal();

        return new Promise(resolve => {
            const cancelBtn = $('#confirm-dialog-cancel', dialog);
            const confirmBtn = $('#confirm-dialog-confirm', dialog);

            cancelBtn.onclick = () => { dialog.close(); resolve(false); };
            confirmBtn.onclick = () => { dialog.close(); resolve(true); };
        });
    }

    /**
     * Shows a modal dialog prompting the user for a denial reason.
     * The reason is required and cannot be submitted empty.
     * @param {string} [title='Deny Report']
     * @param {string} [message]
     * @returns {Promise<string|null>} Resolves with the non-empty denial reason, or null if cancelled.
     */
    function showDenyDialog(title = 'Deny Report', message = 'Please provide a reason why this report is being denied. This reason will be visible to the submitting administrator.') {
        const dialog = $('#deny-dialog');
        if (!dialog) {
            let reason = prompt(`${title}\n\n${message}\n\nEnter denial reason (required):`);
            if (reason === null) return Promise.resolve(null);
            reason = reason.trim();
            while (!reason) {
                alert('A reason for denial is required.');
                reason = prompt('Enter denial reason (required):');
                if (reason === null) return Promise.resolve(null);
                reason = reason.trim();
            }
            return Promise.resolve(reason);
        }

        const titleEl = $('#deny-dialog-title', dialog);
        const msgEl = $('#deny-dialog-message', dialog);
        const formEl = $('#deny-dialog-form', dialog);
        const reasonInput = $('#deny-dialog-reason', dialog);
        const errorEl = $('#deny-dialog-error', dialog);
        const cancelBtn = $('#deny-dialog-cancel', dialog);

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (reasonInput) reasonInput.value = '';
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }

        dialog.showModal();
        if (reasonInput) {
            setTimeout(() => reasonInput.focus(), 50);
        }

        return new Promise(resolve => {
            const handleCancel = () => {
                cleanup();
                dialog.close();
                resolve(null);
            };

            const handleSubmit = (e) => {
                e.preventDefault();
                const reason = (reasonInput?.value || '').trim();
                if (!reason) {
                    if (errorEl) {
                        errorEl.textContent = 'A reason for denial is required before proceeding.';
                        errorEl.style.display = 'block';
                    }
                    reasonInput?.focus();
                    return;
                }
                cleanup();
                dialog.close();
                resolve(reason);
            };

            const handleClose = () => {
                cleanup();
                resolve(null);
            };

            function cleanup() {
                cancelBtn?.removeEventListener('click', handleCancel);
                formEl?.removeEventListener('submit', handleSubmit);
                dialog.removeEventListener('close', handleClose);
            }

            cancelBtn?.addEventListener('click', handleCancel);
            formEl?.addEventListener('submit', handleSubmit);
            dialog.addEventListener('close', handleClose);
        });
    }

    function applyTheme(theme, persist = false) {
        const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.dataset.theme = normalizedTheme;

        const toggle = $('#theme-toggle');
        const darkModeEnabled = normalizedTheme === 'dark';
        if (toggle) {
            toggle.setAttribute('aria-pressed', String(darkModeEnabled));
            toggle.setAttribute('aria-label', darkModeEnabled ? 'Switch to light mode' : 'Switch to dark mode');
            $('.theme-toggle-icon', toggle).textContent = darkModeEnabled ? '\u2600' : '\u263e';
            $('.theme-toggle-label', toggle).textContent = darkModeEnabled ? 'Light mode' : 'Dark mode';
        }

        if (persist) {
            localStorage.setItem('greenmap-theme', normalizedTheme);
        }

        if (map) {
            setTimeout(() => map.invalidateSize(), 50);
        }
    }

    function setupThemeToggle() {
        applyTheme(document.documentElement.dataset.theme || 'light');
        $('#theme-toggle')?.addEventListener('click', () => {
            const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme, true);
        });
    }

    async function apiRequest(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        const sessionId = localStorage.getItem('greenmap_session_id');
        if (sessionId) {
            headers['X-Session-Id'] = sessionId;
            headers['Authorization'] = 'Bearer ' + sessionId;
        }

        const response = await fetch(`${apiBaseUrl}${path}`, {
            credentials: 'include', // required so PHP session cookies are sent
            ...options,
            headers
        });
        const text = await response.text();
        let result = null;
        try {
            result = JSON.parse(text);
        } catch {
            // response was not JSON (e.g. server crash or HTML error)
        }

        if (!response.ok || !result?.success) {
            const message = result?.message || (text.trim() && text.length < 150 && !text.includes('<') ? text.trim() : `Server error (${response.status})`);
            throw new Error(message || 'The database request failed.');
        }

        return result;
    }

    // --- Auth --------------------------------------------------------------

    async function checkAuth() {
        try {
            const result = await apiRequest('authentication/me.php');
            if (result.loggedIn && result.user) {
                currentUser = result.user;
            } else {
                currentUser = null;
                localStorage.removeItem('greenmap_session_id');
            }
        } catch {
            currentUser = null;
        }
    }

    async function login(email, password) {
        const result = await apiRequest('authentication/login.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (result.sessionId || result.token) {
            localStorage.setItem('greenmap_session_id', result.sessionId || result.token);
        }
        currentUser = result.user;
    }

    async function logout() {
        try {
            await apiRequest('authentication/logout.php', { method: 'POST' });
        } catch {}
        localStorage.removeItem('greenmap_session_id');
        currentUser = null;
    }

    function showLoginScreen() {
        $('#login-dialog')?.showModal();
    }

    function showApp() {
        $('#login-dialog')?.close();
    }

    function setupFormFieldHandlers(form) {
        $$('input, textarea', form).forEach(input => {
            const field = input.closest('.form-field');
            if (!field) return;

            const update = () => field.classList.toggle('has-value', input.value !== '');

            input.addEventListener('input', update);
            update(); // Initial check in case of autofill
        });
    }

    function setupLoginForm() {
        const form = $('#login-form');
        if (!form) return; // see HTML note below

        form.onsubmit = async event => {
            event.preventDefault();
            const data = new FormData(form);
            const submitButton = form.querySelector('[type="submit"]');
            submitButton.disabled = true;

            try {
                await login(data.get('email').trim(), data.get('password'));
                form.reset();
                showApp(); // hide the login form/modal if it's currently shown
                applyRoleVisibility();
                welcome();
                await loadProfile();
                await loadMyContributions();
                if ($('.menu li.active')?.dataset.page === 'dashboard') {
                    setupDashboard();
                }
                toast('Logged in.');
            } catch (error) {
                toast(error.message);
            } finally {
                submitButton.disabled = false;
            }
        };

        setupFormFieldHandlers(form);
    }

    function setupLogoutButton() {
        $$('.logout-btn, #logout-button, #drawer-logout-button').forEach(button => {
            button.onclick = async () => {
                try {
                    await logout();
                    databaseContributions = [];
                    applyRoleVisibility();
                    welcome();
                    await navigate('map');
                    toast('Logged out.');
                } catch (error) {
                    toast(error.message);
                }
            };
        });
    }

    // --- Species -------------------------------------------------------------

    async function loadSpeciesList(query = '') {
        const result = await apiRequest(`species/search.php?q=${encodeURIComponent(query)}&limit=100`);
        speciesList = result.species;
        return speciesList;
    }

    function populateSpeciesSelect(select) {
        if (!select) return;
        select.innerHTML = '<option value="">Select a species...</option>'
            + speciesList.map(species =>
                `<option value="${species.speciesId}">${escapeHtml(species.commonName)} (${escapeHtml(species.scientificName)})</option>`
            ).join('')
            + '<option value="new">+ Add a new species</option>';

        if (!speciesList.length) {
            select.value = 'new';
        }
    }

    // --- Trees ---------------------------------------------------------------

    async function saveTreeToDatabase(tree) {
        const body = new FormData();
        // New action fields
        if (tree.treeId)     body.append('tree_id', tree.treeId);
        if (tree.actionType) body.append('action_type', tree.actionType);
        if (tree.priority)   body.append('priority', tree.priority);
        if (tree.areaType)   body.append('area_type', tree.areaType);
        if (tree.reason)     body.append('reason', tree.reason);
        if (tree.address)    body.append('address', tree.address);
        // Reporter contact (optional, public form)
        if (tree.reporterName)    body.append('reporter_name',    tree.reporterName);
        if (tree.reporterContact) body.append('reporter_contact', tree.reporterContact);
        // Species (optional)
        if (tree.speciesId)      body.append('species_id', tree.speciesId);
        if (tree.commonName)     body.append('common_name', tree.commonName);
        if (tree.scientificName) body.append('scientific_name', tree.scientificName);
        if (tree.originStatus)   body.append('origin_status', tree.originStatus);
        if (tree.description)    body.append('description', tree.description);
        // Tree condition (optional)
        body.append('tree_status', tree.status || 'Healthy');
        if (tree.age !== null && tree.age !== undefined) body.append('tree_age', tree.age);
        body.append('latitude', tree.lat);
        body.append('longitude', tree.lon);
        if (tree.photo) body.append('tree_photo', tree.photo, tree.photo.name || 'tree_photo.jpg');

        return apiRequest('submissions/create.php', {
            method: 'POST',
            body,
        });
    }

    async function loadDatabaseTrees() {
        const result = await apiRequest('trees/list.php');
        databaseTrees = result.trees;
    }

    async function loadMyContributions() {
        if (!isAdmin()) {
            databaseContributions = [];
            return databaseContributions;
        }

        const result = await apiRequest('submissions/list.php');
        databaseContributions = result.contributions;
        return databaseContributions;
    }

    async function loadReviewSubmissions(status = 'Pending') {
        const result = await apiRequest(`reviews/list.php?status=${encodeURIComponent(status)}`);
        return result.submissions;
    }

    async function reviewSubmission(submissionId, decision, rejectionReason = '') {
        return apiRequest('reviews/update.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                submission_id: submissionId,
                decision,
                rejection_reason: rejectionReason,
            }),
        });
    }

    async function markSubmissionCompleted(submissionId) {
        return apiRequest('reviews/complete.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submission_id: submissionId }),
        });
    }

    async function loadAdminAccounts() {
        const result = await apiRequest('admins/list.php');
        return result.admins;
    }

    async function createAdminAccount(admin) {
        return apiRequest('admins/create.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(admin),
        });
    }

    async function loadIssueReports() {
        const result = await apiRequest('issues/list.php');
        return result.reports;
    }

    // --- Profile ---------------------------------------------------------------

    async function loadProfile() {
        const result = await apiRequest('profile.php');
        currentUser = { ...currentUser, ...result.profile };
    }

    // --- Point-in-polygon barangay lookup -----------------------------------

    function pointInRing(lat, lon, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [lonI, latI] = ring[i];
            const [lonJ, latJ] = ring[j];
            const intersects = ((lonI > lon) !== (lonJ > lon))
                && (lat < (latJ - latI) * (lon - lonI) / (lonJ - lonI) + latI);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function pointInPolygon(lat, lon, rings) {
        if (!rings?.length || !pointInRing(lat, lon, rings[0])) return false;
        return !rings.slice(1).some(hole => pointInRing(lat, lon, hole));
    }

    function geometryContainsPoint(geometry, lat, lon) {
        if (geometry?.type === 'Polygon') {
            return pointInPolygon(lat, lon, geometry.coordinates);
        }
        if (geometry?.type === 'MultiPolygon') {
            return geometry.coordinates.some(polygon => pointInPolygon(lat, lon, polygon));
        }
        return false;
    }

    function isPointInsidePasig(lat, lon) {
        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            return false;
        }
        if (!barangayPolygons.length) {
            return false;
        }
        return barangayPolygons.some(polygon =>
            geometryContainsPoint(polygon.geometry, lat, lon)
        );
    }

    async function ensureBoundaryData() {
        if (barangayPolygons.length) return true;
        try {
            await loadBoundaryData();
            return barangayPolygons.length > 0;
        } catch {
            return false;
        }
    }

    function barangayForPoint(lat, lon) {
        const match = barangayPolygons.find(polygon => geometryContainsPoint(polygon.geometry, lat, lon));
        return match ? match.name : 'Unmapped';
    }

    function locationForTree(tree) {
        return barangayForPoint(tree.latitude, tree.longitude);
    }

    async function loadBoundaryData() {
        if (boundaryData) return boundaryData;
        if (boundaryDataPromise) return boundaryDataPromise;

        boundaryDataPromise = (async () => {
            const response = await fetch(`${apiBaseUrl}boundaries.php`);
            if (!response.ok) throw new Error('Boundary request failed');

            const data = await response.json();
            const features = data.barangays?.features || [];
            if (features.length !== PASIG_BARANGAYS.length) {
                throw new Error(`Expected ${PASIG_BARANGAYS.length} barangay boundaries, received ${features.length}`);
            }

            barangayPolygons = features.map(feature => ({
                name: feature.properties?.name || 'Barangay',
                geometry: feature.geometry
            }));
            boundaryData = {
                barangays: data.barangays,
                cityBoundary: data.cityBoundary || null
            };

            return boundaryData;
        })().catch(error => {
            boundaryDataPromise = null;
            throw error;
        });

        return boundaryDataPromise;
    }

    function initMap() {
        if (map || !window.L) return;

        map = L.map('map').setView([14.5764, 121.0851], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        boundaryLayer = L.layerGroup().addTo(map);
        treeLayer = L.layerGroup().addTo(map);
        loadPasigBoundaries();
        markers();
        setupMapFilters();
        requestStartupLocation();

        map.on('click', async event => {
            const searchContainer = $('.map-search');
            if (searchContainer?.classList.contains('open')) {
                searchContainer.classList.remove('open');
                $('#map-search-toggle')?.setAttribute('aria-expanded', 'false');
            }

            await ensureBoundaryData();

            const lat = event.latlng.lat;
            const lon = event.latlng.lng;

            if (!isPointInsidePasig(lat, lon)) {
                pendingLocation = null;
                if (pendingLocationMarker) {
                    map.removeLayer(pendingLocationMarker);
                    pendingLocationMarker = null;
                }
                showOutsidePasigWarning('Out of bounds, try again. Selected location must be inside Pasig City.');
                toast('Out of bounds, try again. Selected location is outside Pasig City.');
                return;
            }

            pendingLocation = { lat, lon };

            if (pendingLocationMarker) {
                pendingLocationMarker.setLatLng([lat, lon]);
            } else {
                pendingLocationMarker = L.marker([lat, lon], {
                    icon: L.divIcon({
                        className: 'greenmap-marker greenmap-pinned-marker',
                        html: '<span aria-hidden="true">&#128205;</span>',
                        iconSize: [36, 36],
                        iconAnchor: [18, 34],
                        popupAnchor: [0, -32]
                    }),
                    title: 'Selected Tree Location'
                }).addTo(map);
            }

            const brgy = barangayForPoint(lat, lon);
            pendingLocationMarker.bindPopup(
                `<strong>Pinned Tree Location</strong><br><em>Barangay ${escapeHtml(brgy)}</em><br><small>Go to &ldquo;Report a Tree&rdquo; to use this location.</small>`
            ).openPopup();

            toast(`Location pinned in Barangay ${brgy}. Go to "Report a Tree" to use it.`);
        });
    }

    async function loadPasigBoundaries() {
        if (!boundaryLayer) return;

        try {
            const data = await loadBoundaryData();

            const pasigBounds = L.latLngBounds([]);
            boundaryLayer.clearLayers();

            drawBarangayBoundaries(data.barangays, pasigBounds);
            if (data.cityBoundary) drawCityBoundary(data.cityBoundary, pasigBounds);

            if (pasigBounds.isValid() && !userMarker) {
                map.fitBounds(pasigBounds, { padding: [35, 35] });
            }

            markers();
            populateMapFilters();
            applyMapFilters();
        } catch {
            toast('Pasig boundary overlay could not be loaded.');
        }
    }

    function drawBarangayBoundaries(featureCollection, pasigBounds) {
        const layer = L.geoJSON(featureCollection, {
            style: {
                color: '#2f8f46',
                weight: 2,
                opacity: 0.85,
                fill: false
            },
            onEachFeature: (feature, featureLayer) => {
                featureLayer.bindPopup(`${feature.properties?.name || 'Barangay'} boundary`);
            }
        }).addTo(boundaryLayer);
        pasigBounds.extend(layer.getBounds());
    }

    function drawCityBoundary(relation, pasigBounds) {
        const style = {
            color: '#1769aa',
            weight: 5,
            opacity: 0.95,
            fill: false
        };

        relation.members
            ?.filter(member => member.type === 'way' && member.geometry?.length)
            .forEach(member => {
                const coordinates = member.geometry.map(point => [point.lat, point.lon]);
                const line = L.polyline(coordinates, style)
                    .addTo(boundaryLayer)
                    .bindPopup('Pasig City boundary');
                pasigBounds.extend(line.getBounds());
            });
    }

    function markers() {
        if (!treeLayer) return;

        treeLayer.clearLayers();
        treeMarkers = new Map();

        trees().forEach(tree => {
            const location = locationForTree(tree);
            const isCompleted = tree.operationalStatus === 'Completed';
            const isPending   = (tree.approvalStatus || 'Approved') === 'Pending';
            const actionType  = isPending ? 'Pending' : (isCompleted ? 'Completed' : (tree.actionType || ''));
            const requestedAction = tree.actionType || 'Tree';
            const priority    = tree.priority   || '';
            const address     = tree.address    || '';
            const priorityTag = priority === 'Urgent' ? ' 🔴' : priority === 'High' ? ' 🟠' : '';
            const popupTitle  = isPending ? `❓ Under Review (${escapeHtml(requestedAction)})` : `${escapeHtml(ACTION_ICON_EMOJI[actionType] || '🌿')} ${escapeHtml(actionType || 'Tree')}`;
            const marker = L.marker([tree.latitude, tree.longitude], {
                icon: treeIcon(actionType, isPending),
                title: `${isPending ? 'Under Review' : (actionType || 'Tree')} — ${address || location}`
            })
                .addTo(treeLayer)
                .bindPopup(`
                    <strong>${popupTitle}</strong>${escapeHtml(priorityTag)}<br>
                    <em>${escapeHtml(address || location)}</em><br>
                    <small>${escapeHtml(tree.species?.commonName || 'Unknown species')} &middot; ${escapeHtml(tree.status || '')} &middot; ${escapeHtml((tree.areaType || 'Public') + ' Area')}</small>
                    ${isPending ? '<br><small style="color:#ca8a04; font-weight:700;">Awaiting Superadmin Review</small>' : ''}
                `)
                .on('click', () => {
                    if (map) {
                        map.panTo([tree.latitude, tree.longitude], { animate: true, duration: 0.5 });
                    }
                    showTree(tree, location);
                });

            treeMarkers.set(tree.treeId, { marker, tree, location });
        });
    }

    function distanceMeters(from, to) {
        const radius = 6371000;
        const lat1 = from[0] * Math.PI / 180;
        const lat2 = to[0] * Math.PI / 180;
        const deltaLat = (to[0] - from[0]) * Math.PI / 180;
        const deltaLon = (to[1] - from[1]) * Math.PI / 180;
        const a = Math.sin(deltaLat / 2) ** 2
            + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

        return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function treesNear(coordinates, limit = 8) {
        return trees()
            .map(tree => ({
                tree,
                distance: distanceMeters(coordinates, [tree.latitude, tree.longitude])
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
    }

    function focusLocation(position, options = {}) {
        if (!map) return;

        const coordinates = [position.coords.latitude, position.coords.longitude];
        if (userMarker) {
            userMarker.setLatLng(coordinates);
        } else {
            userMarker = L.marker(coordinates, {
                icon: userIcon(),
                title: 'My Location'
            }).addTo(map).bindPopup('My Location');
        }

        // Check if the user is inside Pasig City and show a warning if not
        if (barangayPolygons.length) {
            const insidePasig = isPointInsidePasig(coordinates[0], coordinates[1]);
            userInsidePasig = insidePasig;
            if (!insidePasig) {
                showOutsidePasigWarning('You are currently outside Pasig City.');
            }
        }

        const nearby = treesNear(coordinates);
        if (nearby.length && nearby[0].distance <= 3000) {
            const bounds = L.latLngBounds([
                coordinates,
                ...nearby
                    .filter(item => item.distance <= 3000)
                    .map(item => [item.tree.latitude, item.tree.longitude])
            ]);
            map.fitBounds(bounds, { padding: [70, 70], maxZoom: 17 });
        } else {
            map.setView(coordinates, options.zoom || 17);
            if (options.startup) {
                toast('Your location is centered. No saved trees are nearby yet.');
            }
        }

        const noResultsOverlay = $('#map-no-results');
        if (noResultsOverlay) {
            if (noResultsOverlay.parentNode === map.getContainer()) {
                map.getContainer().removeChild(noResultsOverlay);
            }
        }
    }

    function requestStartupLocation() {
        if (startupLocationRequested) return;
        startupLocationRequested = true;
        locate(null, { startup: true });
    }

    function showTree(tree, location) {
        const image = $('#tree-img');
        const trigger = $('#tree-photo-trigger');
        selectedTreePhotoUrl = resolvePhotoUrl(tree.photo);

        if (selectedTreePhotoUrl) {
            image.src = selectedTreePhotoUrl;
            image.alt = `${tree.actionType || 'Tree'} at ${tree.address || location}`;
            trigger.style.display = '';
        } else {
            image.src = '';
            image.alt = 'No photo available';
            trigger.style.display = 'none';
        }

        // Action type badge
        const isPending  = (tree.approvalStatus || 'Approved') === 'Pending';
        const isDenied   = (tree.approvalStatus === 'Rejected' || tree.approvalStatus === 'Denied');
        const actionType = tree.actionType || '';
        const priority   = tree.priority   || 'Moderate';
        const address    = tree.address    || '';
        const reason     = tree.reason     || '';
        const color      = isPending ? '#ca8a04' : (isDenied ? '#dc2626' : (ACTION_COLORS[actionType] || 'var(--primary)'));

        const nameEl = $('#tree-name');
        if (nameEl) nameEl.textContent = address || tree.species?.commonName || 'Tree Action Report';

        const actionEl = $('#tree-action');
        if (actionEl) {
            if (isPending) {
                actionEl.innerHTML = `<span class="action-badge action-pending" style="background:#ca8a04; color:#fff; font-weight:700;" title="Awaiting Superadmin Review">❓ Under Review (${escapeHtml(actionType || 'Report')})</span>`;
            } else if (isDenied) {
                actionEl.innerHTML = `<span class="action-badge action-denied" style="background:#dc2626; color:#fff; font-weight:700;" title="Report Denied">⛔ Denied (${escapeHtml(actionType || 'Report')})</span>`;
            } else {
                actionEl.innerHTML = `<span class="action-badge action-${(actionType || 'unknown').toLowerCase()}" style="background:${color}">${escapeHtml(ACTION_ICON_EMOJI[actionType] || '🌿')} ${escapeHtml(actionType || 'Unknown')}</span>`;
            }
        }

        const priorityEl = $('#tree-priority');
        if (priorityEl) {
            const urgentMark = priority === 'Urgent' ? ' 🔴' : priority === 'High' ? ' 🟠' : '';
            priorityEl.textContent = `Priority: ${priority}${urgentMark}`;
        }

        const statusEl = $('#tree-status');
        if (statusEl) statusEl.textContent = `Condition: ${tree.status || '–'}${tree.species?.commonName ? ` (${tree.species.commonName})` : ''}`;

        const locationEl = $('#tree-location');
        if (locationEl) locationEl.textContent = `Barangay: ${location || locationForTree(tree)}`;

        const areaEl = $('#tree-area');
        if (areaEl) {
            const area = tree.areaType || 'Public';
            areaEl.textContent = `Area: ${area} Property`;
        }

        const addressEl = $('#tree-address');
        if (addressEl) addressEl.textContent = `Address: ${address || '–'}`;

        const reasonEl = $('#tree-reason');
        if (reasonEl) reasonEl.textContent = reason ? `Reason: ${reason}` : '';

        const denialReasonEl = $('#tree-denial-reason');
        const denialReasonTextEl = $('#tree-denial-reason-text');
        if (denialReasonEl && denialReasonTextEl) {
            if (isDenied && tree.rejectionReason) {
                denialReasonTextEl.textContent = tree.rejectionReason;
                denialReasonEl.classList.remove('hidden');
            } else {
                denialReasonTextEl.textContent = '';
                denialReasonEl.classList.add('hidden');
            }
        }

        const addedByEl = $('#tree-addedby');
        const addedBy = tree.addedBy || tree.submittedBy?.name || 'Unknown';
        if (addedByEl) addedByEl.textContent = `Reported by: ${addedBy}`;

        const streetViewLink = $('#view-streetview');
        if (streetViewLink) {
            const coordinates = encodeURIComponent(`${tree.latitude},${tree.longitude}`);
            streetViewLink.href = `https://www.instantstreetview.com/s/${coordinates}`;
        }

        selectedTreeForResubmit = tree;
        const resubmitBtn = $('#resubmit-tree-btn');
        if (resubmitBtn) {
            const isCompleted = tree.operationalStatus === 'Completed';
            resubmitBtn.classList.toggle('hidden', !isCompleted);
        }

        $('.tree-popup').classList.remove('hidden');
    }

    function openTreePhoto(customSrc = null) {
        const source = $('#tree-img');
        const fullscreenImage = $('#fullscreen-tree-img');
        const dialog = $('#photo-viewer-dialog');
        if (!fullscreenImage || !dialog) return;

        const targetSrc = (typeof customSrc === 'string' && customSrc)
            ? customSrc
            : resolvePhotoUrl(selectedTreePhotoUrl || source?.src);
        if (!targetSrc) return;

        fullscreenImage.onerror = null;
        fullscreenImage.src = targetSrc;
        fullscreenImage.alt = source?.alt || 'Tree photo';
        dialog.showModal();
    }

    function closeTreePhoto() {
        $('#photo-viewer-dialog')?.close();
    }

    // --- Map search / filter bar ---------------------------------------------

    function populateMapFilters() {
        const locationFilter = $('#map-location-filter');
        if (!locationFilter) return;

        const currentLocation = locationFilter.value;

        locationFilter.innerHTML = '<option value="">All Barangays</option>'
            + [...PASIG_BARANGAYS].sort().map(location => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('');

        if ([...locationFilter.options].some(option => option.value === currentLocation)) {
            locationFilter.value = currentLocation;
        }
    }

    function applyMapFilters() {
        const searchInput    = $('#map-species-search');
        const actionFilter   = $('#map-status-filter');     // re-uses the same element, now filters action type
        const locationFilter = $('#map-location-filter');
        if (!searchInput || !actionFilter || !locationFilter) return;

        const query  = searchInput.value.toLowerCase().trim();
        const action = actionFilter.value;
        const loc    = locationFilter.value;
        const hasActiveFilter = Boolean(query || action || loc);
        let matchCount = 0;

        treeMarkers.forEach(({ marker, tree, location: treeLocation }) => {
            const hay = [
                tree.actionType || '',
                tree.address    || '',
                tree.reason     || '',
                tree.species?.commonName || '',
            ].join(' ').toLowerCase();

            const matchesQuery    = !query  || hay.includes(query);
            const isTreePending   = (tree.approvalStatus || 'Approved') === 'Pending';
            const matchesAction   = !action
                || (action === 'Pending' ? isTreePending
                    : action === 'Completed' ? tree.operationalStatus === 'Completed'
                    : !isTreePending && tree.actionType === action && tree.operationalStatus !== 'Completed');
            const matchesLocation = !loc    || treeLocation === loc;
            const matches = matchesQuery && matchesAction && matchesLocation;

            if (matches) matchCount++;

            marker.setOpacity(!hasActiveFilter || matches ? 1 : 0.18);
            marker.setZIndexOffset(matches && hasActiveFilter ? 1000 : 0);
        });

        const noResultsOverlay = $('#map-no-results') || document.createElement('div');
        noResultsOverlay.id = 'map-no-results';
        noResultsOverlay.className = 'map-no-results-overlay';
        noResultsOverlay.innerHTML = '<strong>No reports match your filter</strong><small>Try adjusting your search criteria.</small>';

        if (noResultsOverlay.timer) {
            clearTimeout(noResultsOverlay.timer);
            noResultsOverlay.timer = null;
        }

        if (hasActiveFilter && matchCount === 0) {
            if (!noResultsOverlay.parentNode) {
                map?.getContainer().appendChild(noResultsOverlay);
            }
            noResultsOverlay.timer = setTimeout(() => {
                noResultsOverlay.parentNode?.removeChild(noResultsOverlay);
            }, 2500);
        } else if (noResultsOverlay.parentNode === map?.getContainer()) {
            map.getContainer().removeChild(noResultsOverlay);
        }

        if (loc && map) {
            const barangayFeature = boundaryData?.barangays?.features.find(
                feature => (feature.properties?.name || '') === loc
            );
            if (barangayFeature) {
                const tempLayer = L.geoJSON(barangayFeature);
                map.fitBounds(tempLayer.getBounds(), { padding: [40, 40] });
            }
        } else if (map && !query && !action) {
            const cityBounds = boundaryLayer?.getBounds();
            if (cityBounds?.isValid()) map.fitBounds(cityBounds, { padding: [35, 35] });
        }
    }

    function setupMapFilters() {
        const searchInput    = $('#map-species-search');
        const actionFilter   = $('#map-status-filter');
        const locationFilter = $('#map-location-filter');
        if (!searchInput || !actionFilter || !locationFilter) return;

        populateMapFilters();

        const searchContainer = $('.map-search');
        const toggleButton = $('#map-search-toggle');

        if (searchContainer && toggleButton && !toggleButton.dataset.bound) {
            toggleButton.dataset.bound = 'true';

            toggleButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = searchContainer.classList.toggle('open');
                toggleButton.setAttribute('aria-expanded', String(isOpen));
                toggleButton.title = isOpen ? 'Close search' : 'Search and filters';
                if (isOpen) {
                    searchInput.focus();
                }
            });

            // Prevent Leaflet map panning or zooming while interacting with search elements
            if (window.L && L.DomEvent) {
                L.DomEvent.disableClickPropagation(searchContainer);
                L.DomEvent.disableScrollPropagation(searchContainer);
            }

            // Close on escape key
            searchContainer.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchContainer.classList.remove('open');
                    toggleButton.setAttribute('aria-expanded', 'false');
                    toggleButton.title = 'Search and filters';
                    toggleButton.focus();
                }
            });

            // Close when clicking outside of map-search
            document.addEventListener('click', (e) => {
                if (searchContainer.classList.contains('open') && !searchContainer.contains(e.target)) {
                    searchContainer.classList.remove('open');
                    toggleButton.setAttribute('aria-expanded', 'false');
                    toggleButton.title = 'Search and filters';
                }
            });
        }

        const targetContainer = searchContainer?.querySelector('.map-search-inputs') || searchContainer;
        if (targetContainer && !searchContainer?.querySelector('.clear-filters-btn')) {
            const clearButton = document.createElement('button');
            clearButton.type = 'button';
            clearButton.className = 'map-filter-action clear-filters-btn';
            clearButton.title = 'Clear all filters';
            clearButton.innerHTML = '&#x2715;';

            clearButton.onclick = () => {
                searchInput.value = '';
                actionFilter.value = '';
                actionFilter.selectedIndex = 0;
                locationFilter.value = '';
                locationFilter.selectedIndex = 0;
                applyMapFilters();
                searchInput.focus();
            };

            targetContainer.appendChild(clearButton);
        }

        searchInput.oninput    = applyMapFilters;
        actionFilter.onchange  = applyMapFilters;
        locationFilter.onchange = applyMapFilters;
    }

    // --- Navigation ------------------------------------------------------------

    async function navigate(page, state = {}) {
        if (activeCameraStream) {
            activeCameraStream.getTracks().forEach(t => t.stop());
            activeCameraStream = null;
        }
        if (page === 'contributions' && !isAdmin()) {
            toast('Admin login is required to open that page.')
            return;
        }

        // The edit-admin page is also superadmin-only.
        if (['review-contributions', 'manage-admins', 'reports', 'edit-admin'].includes(page) && !isSuperadmin()) {
            toast('Superadmin access is required to open that page.')
            return;
        }

        // "Report a Tree" is open to everyone — no auth check needed.

        currentPageState = state;

        $$('.menu li').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        $('.menu').classList.remove('open');
        $('.sidebar-footer')?.classList.remove('open');
        $('#page-title').textContent = pageTitles[page] || 'GreenMap';
        const panel = $('#panel');

        // Fade out current content
        panel.classList.add('loading');
        $('#map-area').classList.add('loading');
        await new Promise(resolve => setTimeout(resolve, 200));

        if (page === 'map') {
            $('#map-area').hidden = false;
            panel.classList.add('hidden');
            initMap();
            setTimeout(() => map?.invalidateSize(), 50);
            setTimeout(() => map?.invalidateSize(), 200);
            $('#map-area').classList.remove('loading'); // Fade in map
            return;
        }

        $('#map-area').hidden = true;
        panel.classList.remove('hidden');
        panel.innerHTML = '<p>Loading...</p>';

        try {
            const response = await fetch(`pages/${page}.${pageExtension}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`Could not load ${page}`);
            const documentFragment = new DOMParser().parseFromString(await response.text(), 'text/html');
            panel.innerHTML = documentFragment.body.innerHTML;
            setup(page);
        } catch {
            panel.innerHTML = '<h2>Page unavailable</h2><p>Run the project through XAMPP/Apache, for example: http://localhost/Greenmap/index.php</p>';
        } finally {
            // Fade in new content
            panel.classList.remove('loading');
        }
    }

    function setup(page) {
        if (page === 'add-tree') addTree();
        if (page === 'contributions') contributions();
        if (page === 'review-contributions') reviewContributions();
        if (page === 'manage-admins') manageAdmins();
        if (page === 'reports') reports();
        if (page === 'edit-admin') editAdmin();
        if (page === 'account') accountPage();
        if (page === 'report-details') reportDetails();
        if (page === 'report-issue') reportIssue();

        if (page === 'dashboard') {
            setupDashboard();
        }
    }

    function contributionsByCurrentAdmin() {
        return isAdmin() ? databaseContributions : [];
    }

    function setupDashboard() {
        const barangayFilter = $('#dashboard-barangay-filter');
        if (barangayFilter) {
            barangayFilter.innerHTML = '<option value="">All Barangays</option>'
                + PASIG_BARANGAYS.map(barangay => `<option value="${escapeHtml(barangay)}">${escapeHtml(barangay)}</option>`).join('');
            barangayFilter.value = dashboardBarangayFilter;
            barangayFilter.onchange = () => {
                dashboardBarangayFilter = barangayFilter.value;
                renderDashboard();
            };
        }

        const reportButton = $('#generate-report');
        if (reportButton) reportButton.onclick = generateReport;

        renderDashboard();
        applyRoleVisibility();
    }

    function recordsForBarangay(records, barangay = dashboardBarangayFilter) {
        return barangay
            ? records.filter(tree => locationForTree(tree) === barangay)
            : records;
    }

    function renderDashboard() {
        const allTrees   = recordsForBarangay(trees());
        const myTrees    = recordsForBarangay(contributionsByCurrentAdmin());

        // Action type counts (only non-completed active reports)
        const trimCount   = allTrees.filter(t => t.actionType === 'Trim'   && t.operationalStatus !== 'Completed').length;
        const moveCount   = allTrees.filter(t => t.actionType === 'Move'   && t.operationalStatus !== 'Completed').length;
        const removeCount = allTrees.filter(t => t.actionType === 'Remove' && t.operationalStatus !== 'Completed').length;
        const urgentCount = allTrees.filter(t => t.priority   === 'Urgent' && t.operationalStatus !== 'Completed').length;

        // Completed this month
        const thisMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
        const completedCount = allTrees.filter(t =>
            t.operationalStatus === 'Completed' &&
            (t.submittedAt || '').slice(0, 7) === thisMonth
        ).length;

        if ($('#count-trim'))      $('#count-trim').textContent      = trimCount;
        if ($('#count-move'))      $('#count-move').textContent      = moveCount;
        if ($('#count-remove'))    $('#count-remove').textContent    = removeCount;
        if ($('#count-urgent'))    $('#count-urgent').textContent    = urgentCount;
        if ($('#count-completed')) $('#count-completed').textContent = completedCount;

        renderActionTypeChart(allTrees);
        renderBarangayChart(allTrees);
        renderUrgentList($('#urgent-activity'), allTrees);
        renderRecentActivityList($('#recent-activity'), allTrees, 'No action reports have been recorded yet.');
        renderRecentActivityList($('#dashboard-contributions'), myTrees, 'You have no approved reports yet.');
    }

    function renderActionTypeChart(allTrees) {
        const chart = $('#species-chart');
        if (!chart) return;

        const totals = new Map([['Trim', 0], ['Move', 0], ['Remove', 0]]);
        allTrees.forEach(tree => {
            const type = tree.actionType;
            if (totals.has(type)) totals.set(type, totals.get(type) + 1);
        });

        const entries = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        if (!entries.length) {
            chart.innerHTML = '<div class="dashboard-empty"><strong>No action data</strong><small>Reports will appear here once trees are flagged.</small></div>';
            return;
        }

        const maximum = Math.max(...entries.map(([, v]) => v));
        chart.innerHTML = entries.map(([type, total]) => `
            <div class="bar-chart-row">
                <span class="bar-chart-label" title="${escapeHtml(type)}">${escapeHtml(ACTION_ICON_EMOJI[type] || '')} ${escapeHtml(type)}</span>
                <span class="bar-chart-track"><i class="bar-chart-fill action-fill-${type.toLowerCase()}" style="width:${(total / maximum) * 100}%"></i></span>
                <span class="bar-chart-value">${total}</span>
            </div>
        `).join('');
    }

    function renderBarangayChart(allTrees) {
        const chart = $('#barangay-chart');
        if (!chart) return;

        const totals = new Map();
        allTrees.forEach(tree => {
            const loc = locationForTree(tree);
            totals.set(loc, (totals.get(loc) || 0) + 1);
        });

        const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
        if (!entries.length) {
            chart.innerHTML = '<div class="dashboard-empty"><strong>No barangay data</strong><small>Reports will be mapped to barangays once approved.</small></div>';
            return;
        }

        const maximum = entries[0][1];
        chart.innerHTML = entries.map(([name, total]) => `
            <div class="bar-chart-row">
                <span class="bar-chart-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                <span class="bar-chart-track"><i class="bar-chart-fill" style="width:${(total / maximum) * 100}%"></i></span>
                <span class="bar-chart-value">${total}</span>
            </div>
        `).join('');
    }

    function renderUrgentList(list, allTrees) {
        if (!list) return;
        const urgentTrees = allTrees.filter(t => t.priority === 'Urgent').slice(0, 5);
        list.innerHTML = urgentTrees.length
            ? urgentTrees.map(tree => {
                const loc = locationForTree(tree);
                const actionType = tree.actionType || 'Unknown';
                return `<li>
                    <span>${escapeHtml(ACTION_ICON_EMOJI[actionType] || '🌿')} ${escapeHtml(tree.address || loc)}</span>
                    <small>${escapeHtml(actionType)} &middot; ${escapeHtml(loc)}</small>
                </li>`;
            }).join('')
            : `<li><span>No urgent reports</span><small>All clear — no trees flagged as urgent.</small></li>`;
    }

    function renderRecentActivityList(list, records, emptyMessage) {
        if (!list) return;
        list.innerHTML = records.length
            ? records.slice(0, 5).map(tree => {
                const submitted = tree.submittedAt
                    ? new Date(tree.submittedAt.replace(' ', 'T')).toLocaleDateString()
                    : 'Date unavailable';
                const actionType = tree.actionType || tree.status || '–';
                const label = ACTION_ICON_EMOJI[actionType]
                    ? `${ACTION_ICON_EMOJI[actionType]} ${actionType}`
                    : actionType;
                const statusDisplay = (tree.approvalStatus === 'Rejected' || tree.approvalStatus === 'Denied') ? 'Denied' : tree.approvalStatus;
                const approvalTag = tree.approvalStatus ? ` · ${statusDisplay}` : '';
                return `<li>
                    <span>${escapeHtml(tree.address || tree.species?.commonName || 'Tree')}</span>
                    <small>${escapeHtml(label)}${escapeHtml(approvalTag)} · ${escapeHtml(submitted)}</small>
                </li>`;
            }).join('')
            : `<li><span>No recent activity</span><small>${escapeHtml(emptyMessage)}</small></li>`;
    }

    // Keep renderActivityList as an alias for backward compatibility with any other callers
    const renderActivityList = renderRecentActivityList;

    function csvValue(value) {
        return `"${String(value ?? '').replaceAll('"', '""')}"`;
    }

    function generateReport() {
        if (!isAdmin()) {
            toast('Admin login is required to generate reports.');
            return;
        }

        const records = recordsForBarangay(trees());
        const rows = [
            ['Report ID', 'Action Type', 'Priority', 'Area Type', 'Address', 'Reason', 'Species', 'Condition', 'Barangay', 'Latitude', 'Longitude', 'Reported At', 'Reported By'],
            ...records.map(tree => [
                tree.treeId,
                tree.actionType || '',
                tree.priority   || '',
                tree.areaType   || 'Public',
                tree.address    || '',
                tree.reason     || '',
                tree.species?.commonName || '',
                tree.status || '',
                locationForTree(tree),
                tree.latitude,
                tree.longitude,
                tree.submittedAt,
                tree.addedBy,
            ]),
        ];
        const csv = rows.map(row => row.map(csvValue).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        const barangaySuffix = dashboardBarangayFilter
            ? `-${dashboardBarangayFilter.toLowerCase().replaceAll(' ', '-')}`
            : '';
        link.download = `greenmap-action-report${barangaySuffix}-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        const scope = dashboardBarangayFilter || 'all barangays';
        toast(`Report exported for ${scope} with ${records.length} record${records.length === 1 ? '' : 's'}.`);
    }

    async function addTree() {
        const form = $('#add-tree-form');
        if (!form) return;

        // Restrict Move/Relocate to staff (admin or superadmin)
        const actionTypeSelect = $('#action-type-select', form);
        if (actionTypeSelect && !isAdmin()) {
            const moveOption = actionTypeSelect.querySelector('option[value="Move"]');
            if (moveOption) moveOption.remove();
        }

        const speciesSelect  = $('#species-select', form);
        const newSpeciesFields = $('#new-species-fields', form);

        const toggleNewSpecies = () => {
            const addsNewSpecies = speciesSelect.value === 'new';
            newSpeciesFields.classList.toggle('hidden', !addsNewSpecies);
            ['common_name', 'scientific_name'].forEach(name => {
                const input = form.elements[name];
                if (input) input.required = addsNewSpecies;
            });
        };

        // Coordinate inputs validation and boundary feedback
        const latInput = form.latitude;
        const lonInput = form.longitude;
        const coordContainer = latInput?.closest('.field');
        let feedbackEl = $('#location-boundary-status', form);
        if (!feedbackEl && coordContainer) {
            feedbackEl = document.createElement('div');
            feedbackEl.id = 'location-boundary-status';
            feedbackEl.className = 'location-boundary-status';
            coordContainer.appendChild(feedbackEl);
        }

        const validateLocationInputs = (showWarningOnInvalid = false) => {
            if (!latInput || !lonInput) return false;
            const rawLat = latInput.value.trim();
            const rawLon = lonInput.value.trim();

            if (!rawLat || !rawLon) {
                latInput.setCustomValidity('');
                lonInput.setCustomValidity('');
                if (feedbackEl) {
                    feedbackEl.textContent = '';
                    feedbackEl.className = 'location-boundary-status';
                }
                return false;
            }

            const lat = Number(rawLat);
            const lon = Number(rawLon);

            if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                latInput.setCustomValidity('Please enter valid coordinates.');
                if (feedbackEl) {
                    feedbackEl.textContent = 'Please enter valid numerical coordinates.';
                    feedbackEl.className = 'location-boundary-status invalid';
                }
                return false;
            }

            if (!barangayPolygons.length) {
                return true;
            }

            const inside = isPointInsidePasig(lat, lon);
            if (!inside) {
                const msg = 'Out of bounds, try again. Location must be inside Pasig City border.';
                latInput.setCustomValidity(msg);
                lonInput.setCustomValidity(msg);
                if (feedbackEl) {
                    feedbackEl.textContent = '⚠ ' + msg;
                    feedbackEl.className = 'location-boundary-status invalid';
                }
                if (showWarningOnInvalid) {
                    showOutsidePasigWarning('Out of bounds, try again. Selected location is outside Pasig City.');
                    toast('Out of bounds, try again. Coordinates must be inside Pasig City.');
                }
                return false;
            }

            latInput.setCustomValidity('');
            lonInput.setCustomValidity('');
            const brgy = barangayForPoint(lat, lon);
            if (feedbackEl) {
                feedbackEl.textContent = `✓ Inside Pasig City (Barangay ${brgy})`;
                feedbackEl.className = 'location-boundary-status valid';
            }
            return true;
        };

        latInput?.addEventListener('input', () => validateLocationInputs(false));
        lonInput?.addEventListener('input', () => validateLocationInputs(false));
        latInput?.addEventListener('blur', () => {
            if (latInput.value && lonInput.value) validateLocationInputs(true);
        });
        lonInput?.addEventListener('blur', () => {
            if (latInput.value && lonInput.value) validateLocationInputs(true);
        });

        // Pre-fill coordinates from a map click, if available and inside Pasig
        if (pendingLocation) {
            if (isPointInsidePasig(pendingLocation.lat, pendingLocation.lon)) {
                form.latitude.value  = pendingLocation.lat.toFixed(6);
                form.longitude.value = pendingLocation.lon.toFixed(6);
            }
            pendingLocation = null;
            if (pendingLocationMarker && map) {
                map.removeLayer(pendingLocationMarker);
                pendingLocationMarker = null;
            }
        }
        validateLocationInputs(false);

        // Populate species dropdown (optional — "" = no species)
        try {
            await loadSpeciesList();
            if (speciesSelect) {
                speciesSelect.innerHTML = '<option value="">Unknown / not sure</option>'
                    + speciesList.map(s =>
                        `<option value="${s.speciesId}">${escapeHtml(s.commonName)} (${escapeHtml(s.scientificName)})</option>`
                    ).join('')
                    + '<option value="new">+ Add a new species</option>';
            }
        } catch (error) {
            if (speciesSelect) speciesSelect.innerHTML = '<option value="">Unknown / not sure</option><option value="new">+ Add a new species</option>';
            toast(`Could not load species list: ${error.message}`);
        }

        speciesSelect?.addEventListener('change', toggleNewSpecies);
        toggleNewSpecies();

        // Photo upload & device camera handling
        const treePhotoFileInput = $('#tree-photo-input', form);
        const nativeCameraInput  = $('#tree-photo-native-camera', form);
        const openCameraBtn      = $('#open-camera-btn', form);
        const photoPreviewCard   = $('#photo-preview-card', form);
        const photoPreviewImg    = $('#photo-preview-img', form);
        const photoPreviewName   = $('#photo-preview-name', form);
        const photoPreviewBadge  = $('#photo-preview-badge', form);
        const photoPreviewSize  = $('#photo-preview-size', form);
        const removePhotoBtn     = $('#remove-photo-btn', form);

        const cameraModal        = $('#camera-modal');
        const cameraVideoFeed    = $('#camera-video-feed');
        const cameraCanvas       = $('#camera-snapshot-canvas');
        const cameraLoading      = $('#camera-loading-indicator');
        const cameraError        = $('#camera-error-message');
        const cameraErrorText    = $('#camera-error-text');
        const cameraFallbackBtn  = $('#camera-system-fallback-btn');
        const switchCameraBtn    = $('#switch-camera-lens-btn');
        const takeSnapshotBtn    = $('#take-snapshot-btn');
        const closeCameraModal   = $('#close-camera-modal');
        const cancelCameraBtn    = $('#cancel-camera-capture');

        let selectedPhotoFile = null;
        let previewObjectUrl  = null;
        let currentFacingMode = 'environment';

        const formatFileSize = bytes => {
            if (!bytes || bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
        };

        photoPreviewImg?.addEventListener('click', () => {
            if (photoPreviewImg.src) openTreePhoto(photoPreviewImg.src);
        });

        const updatePhotoPreview = (file, badgeText = 'Uploaded') => {
            if (previewObjectUrl) {
                URL.revokeObjectURL(previewObjectUrl);
                previewObjectUrl = null;
            }
            if (!file) {
                if (photoPreviewCard) photoPreviewCard.classList.add('hidden');
                if (photoPreviewImg) photoPreviewImg.src = '';
                return;
            }
            previewObjectUrl = URL.createObjectURL(file);
            if (photoPreviewImg) photoPreviewImg.src = previewObjectUrl;
            if (photoPreviewName) photoPreviewName.textContent = file.name || 'tree-photo.jpg';
            if (photoPreviewBadge) photoPreviewBadge.textContent = badgeText;
            if (photoPreviewSize) photoPreviewSize.textContent = formatFileSize(file.size);
            if (photoPreviewCard) photoPreviewCard.classList.remove('hidden');
        };

        const clearPhoto = () => {
            selectedPhotoFile = null;
            if (treePhotoFileInput) treePhotoFileInput.value = '';
            if (nativeCameraInput)  nativeCameraInput.value = '';
            updatePhotoPreview(null);
        };

        const stopCamera = () => {
            if (activeCameraStream) {
                activeCameraStream.getTracks().forEach(track => track.stop());
                activeCameraStream = null;
            }
            if (cameraVideoFeed) {
                cameraVideoFeed.srcObject = null;
            }
            if (cameraModal && cameraModal.open) {
                cameraModal.close();
            }
        };

        const startCamera = async () => {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                if (nativeCameraInput) nativeCameraInput.click();
                return;
            }

            if (!cameraModal) {
                if (nativeCameraInput) nativeCameraInput.click();
                return;
            }

            try {
                cameraModal.showModal();
            } catch {
                if (nativeCameraInput) nativeCameraInput.click();
                return;
            }

            if (cameraLoading) cameraLoading.classList.remove('hidden');
            if (cameraError)   cameraError.classList.add('hidden');

            try {
                if (activeCameraStream) {
                    activeCameraStream.getTracks().forEach(t => t.stop());
                    activeCameraStream = null;
                }

                const constraints = {
                    video: {
                        facingMode: { ideal: currentFacingMode },
                        width:  { ideal: 1920 },
                        height: { ideal: 1080 }
                    },
                    audio: false
                };

                activeCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
                if (cameraVideoFeed) {
                    cameraVideoFeed.srcObject = activeCameraStream;
                    await cameraVideoFeed.play();
                }
                if (cameraLoading) cameraLoading.classList.add('hidden');

                try {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const videoDevices = devices.filter(d => d.kind === 'videoinput');
                    if (switchCameraBtn) {
                        switchCameraBtn.style.display = videoDevices.length > 1 ? '' : 'none';
                    }
                } catch {
                    if (switchCameraBtn) switchCameraBtn.style.display = 'none';
                }
            } catch (error) {
                if (cameraLoading) cameraLoading.classList.add('hidden');
                if (cameraError) {
                    cameraError.classList.remove('hidden');
                    if (cameraErrorText) {
                        cameraErrorText.textContent = error.name === 'NotAllowedError'
                            ? 'Camera permission denied. Allow camera access or use device camera below.'
                            : 'Camera could not be accessed. Use device camera below.';
                    }
                }
            }
        };

        openCameraBtn?.addEventListener('click', startCamera);

        cameraFallbackBtn?.addEventListener('click', () => {
            stopCamera();
            if (nativeCameraInput) nativeCameraInput.click();
        });

        switchCameraBtn?.addEventListener('click', async () => {
            currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
            await startCamera();
        });

        takeSnapshotBtn?.addEventListener('click', () => {
            if (!cameraVideoFeed || !activeCameraStream) return;

            const width  = cameraVideoFeed.videoWidth  || 1280;
            const height = cameraVideoFeed.videoHeight || 720;
            if (!width || !height) return;

            const canvas = cameraCanvas || document.createElement('canvas');
            canvas.width  = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(cameraVideoFeed, 0, 0, width, height);

            canvas.toBlob(blob => {
                if (!blob) {
                    toast('Could not capture photo. Please try again.');
                    return;
                }
                const photoName = `tree_camera_${Date.now()}.jpg`;
                const file = new File([blob], photoName, { type: 'image/jpeg', lastModified: Date.now() });
                selectedPhotoFile = file;

                try {
                    if (window.DataTransfer && treePhotoFileInput) {
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        treePhotoFileInput.files = dt.files;
                    }
                } catch {}

                stopCamera();
                updatePhotoPreview(file, 'Camera');
                toast('Photo captured successfully.');
            }, 'image/jpeg', 0.92);
        });

        closeCameraModal?.addEventListener('click', stopCamera);
        cancelCameraBtn?.addEventListener('click', stopCamera);
        cameraModal?.addEventListener('cancel', stopCamera);

        const handleFileInput = (input, badge) => {
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                toast('The tree photo must be no larger than 5 MB.');
                input.value = '';
                return;
            }
            selectedPhotoFile = file;
            if (input === nativeCameraInput && treePhotoFileInput) {
                try {
                    if (window.DataTransfer) {
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        treePhotoFileInput.files = dt.files;
                    }
                } catch {}
            }
            updatePhotoPreview(file, badge);
        };

        treePhotoFileInput?.addEventListener('change', () => handleFileInput(treePhotoFileInput, 'Uploaded'));
        nativeCameraInput?.addEventListener('change', () => handleFileInput(nativeCameraInput, 'Camera'));
        removePhotoBtn?.addEventListener('click', clearPhoto);

        const inlineRegion = form.closest('#contribution-form-region');
        const cancel = () => {
            stopCamera();
            clearPhoto();
            if (!inlineRegion) {
                navigate('dashboard');
                return;
            }
            inlineRegion.innerHTML = '';
            inlineRegion.classList.add('hidden');
            $('#add-contribution')?.classList.remove('hidden');
        };
        $('#cancel-contribution')?.addEventListener('click', cancel);
        $('#cancel-contribution-bottom')?.addEventListener('click', cancel);

        $('#use-location')?.addEventListener('click', () => locate(async position => {
            await ensureBoundaryData();
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            if (!isPointInsidePasig(lat, lon)) {
                form.latitude.value = '';
                form.longitude.value = '';
                validateLocationInputs(true);
                showOutsidePasigWarning('Out of bounds, try again. Your current GPS location is outside Pasig City.');
                toast('Out of bounds, try again. GPS location is outside Pasig City.');
                return;
            }
            form.latitude.value  = lat.toFixed(6);
            form.longitude.value = lon.toFixed(6);
            validateLocationInputs(false);
            const brgy = barangayForPoint(lat, lon);
            toast(`GPS location set in Barangay ${brgy}.`);
        }));

        form.onsubmit = async event => {
            event.preventDefault();

            await ensureBoundaryData();

            const lat = Number(form.latitude.value);
            const lon = Number(form.longitude.value);

            const isInside = isPointInsidePasig(lat, lon);
            if (isNaN(lat) || isNaN(lon) || !isInside) {
                showOutsidePasigWarning('Out of bounds, try again. Tree location must be inside Pasig City.');
                toast('Out of bounds, try again. Selected location is outside Pasig City.');
                validateLocationInputs(true);
                form.latitude.focus();
                return;
            }

            if (!form.reportValidity()) return;

            const data         = new FormData(form);
            const submitButton = form.querySelector('[type="submit"]');
            submitButton.disabled = true;

            try {
                const selectedSpecies = data.get('species_id');
                const photoFile = (selectedPhotoFile && selectedPhotoFile.size)
                    ? selectedPhotoFile
                    : (data.get('tree_photo')?.size ? data.get('tree_photo') : null);

                const result = await saveTreeToDatabase({
                    // Required action fields
                    actionType: data.get('action_type'),
                    priority:   data.get('priority'),
                    areaType:   data.get('area_type') || 'Public',
                    reason:     data.get('reason')?.trim(),
                    address:    data.get('address')?.trim(),
                    // Reporter contact (optional, public form)
                    reporterName:    data.get('reporter_name')?.trim()    || null,
                    reporterContact: data.get('reporter_contact')?.trim() || null,
                    // Location
                    lat: Number(data.get('latitude')),
                    lon: Number(data.get('longitude')),
                    // Optional species
                    speciesId:      selectedSpecies && selectedSpecies !== 'new' ? Number(selectedSpecies) : null,
                    commonName:     selectedSpecies === 'new' ? data.get('common_name')?.trim()     : null,
                    scientificName: selectedSpecies === 'new' ? data.get('scientific_name')?.trim() : null,
                    originStatus:   selectedSpecies === 'new' ? data.get('origin_status')           : null,
                    description:    selectedSpecies === 'new' ? data.get('description')?.trim()     : null,
                    // Optional condition
                    status: data.get('tree_status') || 'Healthy',
                    age:    null,
                    photo:  photoFile,
                });

                stopCamera();
                clearPhoto();
                await navigate('map');
                if (isAdmin()) {
                    try { await loadMyContributions(); } catch {}
                }
                try {
                    await loadDatabaseTrees();
                    markers();
                    if (map && !isNaN(lat) && !isNaN(lon)) {
                        map.panTo([lat, lon], { animate: true, duration: 0.8 });
                    }
                } catch {}
                const isApproved = result.approvalStatus === 'Approved';
                showMapNotification(
                    'Report Submitted',
                    isApproved
                        ? 'Your report has been approved and appears on the map.'
                        : 'A CENRO admin will review and schedule the action.'
                );
            } catch (error) {
                toast(error.message);
            } finally {
                submitButton.disabled = false;
            }
        };
    }

    async function openContributionForm() {
        const region = $('#contribution-form-region');
        const button = $('#add-contribution');
        if (!region || !button) return;

        button.disabled = true;
        region.classList.remove('hidden');
        region.innerHTML = '<div class="section-card">Loading contribution form...</div>';

        try {
            const response = await fetch(`pages/add-tree.${pageExtension}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('The contribution form could not be loaded.');

            const documentFragment = new DOMParser().parseFromString(await response.text(), 'text/html');
            const formView = $('.contribution-form-view', documentFragment);
            if (!formView) throw new Error('The contribution form is unavailable.');

            region.innerHTML = formView.outerHTML;
            button.classList.add('hidden');
            await addTree();
            region.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            region.innerHTML = `<div class="section-card"><strong>Unable to open form</strong><p>${escapeHtml(error.message)}</p></div>`;
        } finally {
            button.disabled = false;
        }
    }



    async function contributions() {
        const body = $('#contributions-body');
        if (!body) return;

        $('#add-contribution')?.addEventListener('click', openContributionForm);

        try {
            await loadMyContributions();
        } catch (error) {
            body.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
            return;
        }

        const allTrees = contributionsByCurrentAdmin();
        const countByStatus = status => allTrees.filter(tree => tree.approvalStatus === status).length;
        $('#contribution-total').textContent    = allTrees.length;
        $('#contribution-pending').textContent  = countByStatus('Pending');
        $('#contribution-approved').textContent = countByStatus('Approved');
        $('#contribution-rejected').textContent = countByStatus('Rejected');

        const filter = $('#contribution-status-filter');

        const renderRows = () => {
            const visibleTrees = filter.value
                ? allTrees.filter(tree => tree.approvalStatus === filter.value)
                : allTrees;

            body.innerHTML = visibleTrees.length
                ? visibleTrees.map(tree => {
                    const actionType = tree.actionType || '–';
                    const priority   = tree.priority   || '–';
                    const address    = tree.address    || (tree.latitude ? `${tree.latitude.toFixed(4)}, ${tree.longitude.toFixed(4)}` : '–');
                    const areaBadge  = tree.areaType === 'Private' ? '<br><small><span class="area-badge area-private">Private Area</span></small>' : '<br><small><span class="area-badge area-public">Public Area</span></small>';
                    const emoji      = ACTION_ICON_EMOJI[actionType] || '🌿';
                    const submitted  = tree.submittedAt
                        ? new Date(tree.submittedAt.replace(' ', 'T')).toLocaleString()
                        : 'Unavailable';
                    const isDenied    = tree.approvalStatus === 'Rejected' || tree.approvalStatus === 'Denied';
                    const statusLabel = isDenied ? 'Denied' : tree.approvalStatus;
                    const denialBox   = (isDenied && tree.rejectionReason)
                        ? `<div class="denial-reason-box"><strong>Reason for Denial:</strong> ${escapeHtml(tree.rejectionReason)}</div>`
                        : (isDenied ? `<div class="denial-reason-box"><strong>Reason for Denial:</strong> No reason specified.</div>` : '');
                    return `
                    <tr class="${isDenied ? 'row-denied' : ''}">
                        <td><strong>${escapeHtml(emoji)} ${escapeHtml(actionType)}</strong></td>
                        <td><span class="priority-badge priority-${priority.toLowerCase()}">${escapeHtml(priority)}</span></td>
                        <td title="${escapeHtml(tree.reason || '')}">${escapeHtml(address)}${areaBadge}</td>
                        <td>${escapeHtml(submitted)}</td>
                        <td>
                            <span class="status-badge status-${tree.approvalStatus.toLowerCase()}">${escapeHtml(statusLabel)}</span>
                            ${denialBox}
                        </td>
                        <td>
                            <button data-view-submission="${tree.submissionId}">View on Map</button>
                        </td>
                    </tr>
                `}).join('')
                : '<tr><td colspan="6" class="empty-state">No reports match this status.</td></tr>';

            $$('[data-view-submission]', body).forEach(button => {
                button.onclick = () => {
                    const tree = allTrees.find(item => item.submissionId == button.dataset.viewSubmission);
                    navigate('map').then(() => {
                        map.setView([tree.latitude, tree.longitude], 18);
                        showTree(tree, locationForTree(tree));
                    });
                };
            });
        };

        filter.onchange = renderRows;
        renderRows();
    }

    async function reviewContributions() {
        const body   = $('#review-contributions-body');
        const filter = $('#review-status-filter');
        if (!body || !filter) return;

        const render = async () => {
            body.innerHTML = '<tr><td colspan="7" class="empty-state">Loading reports...</td></tr>';

            try {
                const submissions  = await loadReviewSubmissions(filter.value);
                const pendingCount = filter.value === 'Pending'
                    ? submissions.length
                    : (await loadReviewSubmissions('Pending')).length;
                $('#pending-review-count').textContent = `${pendingCount} pending`;

                body.innerHTML = submissions.length
                    ? submissions.map(item => {
                        const actionType      = item.actionType || item.status || '–';
                        const priority        = item.priority   || '–';
                        const address         = item.address    || `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`;
                        const areaBadge       = item.areaType === 'Private' ? '<br><small><span class="area-badge area-private">Private Area</span></small>' : '<br><small><span class="area-badge area-public">Public Area</span></small>';
                        const reason          = item.reason     || '–';
                        const emoji           = ACTION_ICON_EMOJI[actionType] || '🌿';
                        const opStatus        = item.operationalStatus || 'Reported';
                        const isCompleted     = opStatus === 'Completed';
                        const canReview       = item.approvalStatus === 'Pending'
                            && item.submittedBy.id !== currentUser.id;
                        const canMarkComplete = item.approvalStatus === 'Approved' && !isCompleted;

                        // Submitter name & contact
                        const reporterName = (item.reporterName && item.reporterName.trim())
                            || (item.submittedBy?.name && item.submittedBy.name !== 'Anonymous' ? item.submittedBy.name.trim() : '')
                            || item.submittedBy?.name
                            || 'Anonymous';

                        const contact = item.reporterContact?.trim() || '';
                        const email   = item.submittedBy?.email?.trim() || '';

                        const contactLines = [];
                        if (contact) {
                            const icon = contact.includes('@') ? '✉️' : '📞';
                            contactLines.push(`<small title="Reporter contact">${icon} ${escapeHtml(contact)}</small>`);
                        }
                        if (email && email.toLowerCase() !== contact.toLowerCase()) {
                            contactLines.push(`<small title="Account email">✉️ ${escapeHtml(email)}</small>`);
                        }
                        if (!contactLines.length) {
                            contactLines.push('<small class="text-muted">No contact provided</small>');
                        }
                        const contactHtml = contactLines.join('');

                        const actions = canReview
                            ? `<button class="approve-action" data-review-id="${item.submissionId}" data-decision="Approved">Approve</button>
                               <button class="danger-link" data-review-id="${item.submissionId}" data-decision="Rejected">Deny</button>`
                            : item.approvalStatus === 'Pending'
                                ? '<small>Cannot review your own report</small>'
                                : canMarkComplete
                                    ? `<button class="complete-action" data-complete-id="${item.submissionId}">✅ Mark Completed</button>`
                                    : `<small>Reviewed by ${escapeHtml(item.reviewedBy || 'Superadmin')}</small>`;

                        const opStatusBadge   = `<span class="op-status-badge op-${opStatus.toLowerCase()}">${escapeHtml(opStatus)}</span>`;
                        const isItemDenied    = item.approvalStatus === 'Rejected' || item.approvalStatus === 'Denied';
                        const reviewStatusLabel = isItemDenied ? 'Denied' : item.approvalStatus;
                        const reviewDenialBox = (isItemDenied && item.rejectionReason)
                            ? `<div class="denial-reason-box"><strong>Denial reason:</strong> ${escapeHtml(item.rejectionReason)}</div>`
                            : '';

                        return `
                            <tr class="${isCompleted ? 'row-completed' : ''}">
                                <td>
                                    <strong>${escapeHtml(emoji)} ${escapeHtml(actionType)}</strong>
                                    <small><span class="priority-badge priority-${priority.toLowerCase()}">${escapeHtml(priority)}</span></small>
                                </td>
                                <td>
                                    <strong>${escapeHtml(reporterName)}</strong>
                                    ${contactHtml}
                                </td>
                                <td title="${escapeHtml(reason)}">${escapeHtml(reason.length > 60 ? reason.slice(0, 60) + '…' : reason)}</td>
                                <td>${escapeHtml(address)}${areaBadge}</td>
                                <td>${opStatusBadge}</td>
                                <td>
                                    <span class="status-badge status-${item.approvalStatus.toLowerCase()}">${escapeHtml(reviewStatusLabel)}</span>
                                    ${reviewDenialBox}
                                </td>
                                <td class="review-actions">${actions}</td>
                            </tr>
                        `;
                    }).join('')
                    : '<tr><td colspan="7" class="empty-state">No reports match this status.</td></tr>';

                // Approve / Deny buttons
                $$('[data-review-id]', body).forEach(button => {
                    button.onclick = async () => {
                        const decision = button.dataset.decision;
                        let rejectionReason = '';

                        if (decision === 'Rejected' || decision === 'Denied') {
                            const reason = await showDenyDialog(
                                'Deny Report',
                                'Please provide a reason why this report is being denied. This reason will be visible to the submitting administrator in their My Reports page.'
                            );
                            if (!reason) return; // User cancelled or entered empty reason
                            rejectionReason = reason;
                        } else {
                            if (!await showConfirmationDialog('Are you sure you want to approve this report?', 'Approve Report')) return;
                        }

                        button.disabled = true;
                        try {
                            const result = await reviewSubmission(Number(button.dataset.reviewId), decision, rejectionReason);
                            await loadDatabaseTrees();
                            toast(result.message);
                            await render();
                        } catch (error) {
                            toast(error.message);
                            button.disabled = false;
                        }
                    };
                });

                // Mark Completed buttons
                $$('[data-complete-id]', body).forEach(button => {
                    button.onclick = async () => {
                        if (!await showConfirmationDialog('Mark this report as completed? This indicates the tree action has been carried out.', 'Mark Completed')) return;
                        button.disabled = true;
                        try {
                            const result = await markSubmissionCompleted(Number(button.dataset.completeId));
                            await loadDatabaseTrees();
                            toast(result.message);
                            await render();
                        } catch (error) {
                            toast(error.message);
                            button.disabled = false;
                        }
                    };
                });
            } catch (error) {
                body.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
            }
        };

        filter.onchange = render;
        await render();
    }

    async function manageAdmins() {
        const form = $('#create-admin-form');
        const list = $('#admin-list');
        if (!form || !list) return;

        const passwordInput = form.querySelector('input[name="password"]');
        const passwordReveal = form.querySelector('.password-reveal');
        passwordReveal?.addEventListener('click', () => {
            const reveal = passwordInput.type === 'password';
            passwordInput.type = reveal ? 'text' : 'password';
            passwordReveal.setAttribute('aria-pressed', String(reveal));
            passwordReveal.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
            passwordInput.focus();
        });

        const renderAdmins = async () => {
            list.innerHTML = '<div class="dashboard-empty compact-empty">Loading accounts...</div>';
            try {
                const admins = await loadAdminAccounts();
                list.innerHTML = admins.length
                    ? admins.map(admin => `
                        <article class="admin-list-item">
                            <div>
                                <strong>${escapeHtml(admin.name)}</strong>
                                <small>${escapeHtml(admin.email)}</small>
                            </div>
                            <div>
                                <span class="role-badge role-${admin.role}">${escapeHtml(admin.role)}</span>
                                <button class="edit-admin-btn" data-admin-id="${admin.id}" title="Edit Administrator">
                                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L4.75 13.25 2 14l.75-2.75L11.5 2.5z"></path>
                                    </svg>
                                    <span>Edit</span>
                                </button>
                            </div>
                        </article>
                    `).join('')
                    : '<div class="dashboard-empty compact-empty">No administrator accounts found.</div>';
                $$('.edit-admin-btn', list).forEach(btn => btn.onclick = () => navigate('edit-admin', { adminId: Number(btn.dataset.adminId) }));
            } catch (error) {
                list.innerHTML = `<div class="dashboard-empty compact-empty">${escapeHtml(error.message)}</div>`;
            }
        };

        form.onsubmit = async event => {
            event.preventDefault();
            if (!form.reportValidity()) return;

            const data = new FormData(form);
            const submitButton = form.querySelector('[type="submit"]');
            submitButton.disabled = true;

            try {
                const result = await createAdminAccount({
                    name: data.get('name').trim(),
                    email: data.get('email').trim(),
                    password: data.get('password'),
                });
                form.reset();
                passwordInput.type = 'password';
                passwordReveal?.setAttribute('aria-pressed', 'false');
                passwordReveal?.setAttribute('aria-label', 'Show password');
                toast(result.message);
                await renderAdmins();
            } catch (error) {
                toast(error.message);
            } finally {
                submitButton.disabled = false;
            }
        };

        await renderAdmins();
    }

    async function reports() {
        const body = $('#reports-body');
        if (!body) return;

        // Set up the table headers dynamically
        const table = body.closest('.table');
        if (table && !table.querySelector('thead')) {
            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th style="width: 60px;">ID</th>
                    <th>Issue</th>
                    <th>Reporter</th>
                    <th>Email</th>
                    <th>Details</th>
                    <th style="width: 120px;">Status</th>
                </tr>
            `;
            table.prepend(thead);
        }

        const render = async (filterValue = '') => {
            body.innerHTML = `<tr><td colspan="6" class="empty-state">Loading issue reports...</td></tr>`;

            try {
                const reports = await loadIssueReports();
                $('#report-count').textContent = reports.length;

                body.innerHTML = reports.length
                    ? reports
                        .filter(item => !filterValue || (item.status || 'Unread') === filterValue)
                        .map(item => {
                        const status = item.status || 'Unread';
                        const reportedAt = item.reportedAt ? new Date(item.reportedAt.replace(' ', 'T')).toLocaleString() : 'Unknown';
                        const reporterName = item.reporter?.name || 'Anonymous';
                        const reporterEmail = item.reporter?.email || '';

                        return `
                            <tr data-issue-id="${item.issueId}" class="report-row ${status.toLowerCase()}" style="cursor: pointer;">
                                <td>#${item.issueId}</td>
                                <td>
                                    <strong>${escapeHtml(item.issueType)}</strong>
                                    <small>${escapeHtml(reportedAt)}</small>
                                </td>
                                <td>${escapeHtml(reporterName)}</td>
                                <td>${reporterEmail ? escapeHtml(reporterEmail) : '<small>Not provided</small>'}</td>
                                <td>
                                    <div class="details-cell">${escapeHtml(item.details)}</div>
                                </td>
                                <td>
                                    <span class="status-badge status-${status.toLowerCase()}">${escapeHtml(status)}</span>
                                </td>
                            </tr>
                        `;
                    }).join('')
                    : `<tr><td colspan="6" class="empty-state">No issue reports have been submitted.</td></tr>`;

                if (body.innerHTML === '') {
                    body.innerHTML = `<tr><td colspan="6" class="empty-state">No reports match the filter.</td></tr>`;
                }
            } catch (error) {
                body.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
            }
        };

        const filter = $('#report-status-filter');
        if (filter) filter.onchange = () => render(filter.value);
        await render(filter?.value);

        // Attach event delegation handlers for action buttons and report view buttons
        body.addEventListener('click', async (event) => {
            const row = event.target.closest('.report-row');
            if (row) {
                navigate('report-details', { issueId: Number(row.dataset.issueId) });
            }
        });

        // Dialog action buttons
        $('#close-report-dialog')?.addEventListener('click', () => $('#report-dialog')?.close());
        $('#mark-read')?.addEventListener('click', async () => {
            const id = Number($('#report-dialog')?.dataset.currentIssueId);
            if (!id) return;
            try { await apiRequest('issues/update.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue_id: id, action: 'mark_read' }) }); toast('Marked read.'); $('#report-dialog')?.close(); await render(filter?.value); } catch (err) { toast(err.message || 'Could not update report.'); }
        });
        $('#mark-unread')?.addEventListener('click', async () => {
            const id = Number($('#report-dialog')?.dataset.currentIssueId);
            if (!id) return;
            try { await apiRequest('issues/update.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue_id: id, action: 'mark_unread' }) }); toast('Marked unread.'); $('#report-dialog')?.close(); await render(filter?.value); } catch (err) { toast(err.message || 'Could not update report.'); }
        });
    }

    async function reportDetails() {
        const { issueId } = currentPageState;
        if (!issueId) {
            toast('No report ID was provided.');
            navigate('reports');
            return;
        }

        try {
            const reports = await loadIssueReports();
            const report = reports.find(r => r.issueId === issueId);
            if (!report) throw new Error('Report not found.');

            $('#report-detail-title').textContent = `Issue #${report.issueId}: ${report.issueType}`;
            $('#report-detail-meta').textContent = `Reported by ${report.reporter?.name || 'Anonymous'} on ${new Date(report.reportedAt.replace(' ', 'T')).toLocaleString()}`;
            $('#report-detail-content').textContent = report.details || '';

            const updateStatus = async (action) => {
                try {
                    await apiRequest('issues/update.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue_id: issueId, action }) });
                    toast(`Report marked as ${action.split('_')[1]}.`);
                    navigate('reports');
                } catch (err) {
                    toast(err.message || 'Could not update report.');
                }
            };

            $('#mark-report-read').onclick = () => updateStatus('mark_read');
            $('#mark-report-unread').onclick = () => updateStatus('mark_unread');
            $('#close-report-details').onclick = () => navigate('reports');
        } catch (error) {
            toast(error.message);
            navigate('reports');
        }
    }

    async function editAdmin() {
        const { adminId } = currentPageState;
        if (!adminId) {
            toast('No admin ID was provided.');
            navigate('manage-admins');
            return;
        }

        const form = $('#edit-admin-form');
        const title = $('#edit-admin-title');
        const statusToggle = form.querySelector('input[name="status"]');
        const statusLabel = $('#status-label');

        const backLink = $('[data-action="back-to-admins"]');
        if (backLink) {
            backLink.onclick = (e) => { e.preventDefault(); navigate('manage-admins'); };
        }

        try {
            // We need to fetch all admins to find the one we're editing.
            // A dedicated `admins/get.php?id=` endpoint would be more efficient.
            const admins = await loadAdminAccounts();
            const admin = admins.find(a => a.id == adminId);

            if (!admin) throw new Error('Administrator not found.');

            title.textContent = `Edit: ${escapeHtml(admin.name)}`;
            const isActive = (admin.status || 'active') === 'active';
            statusToggle.checked = isActive;
            statusLabel.textContent = `Account is ${isActive ? 'Active' : 'Inactive'}`;

            if (admin.id === currentUser.id) {
                statusToggle.disabled = true;
                const small = statusLabel.closest('.form-grid').querySelector('small');
                if (small) small.textContent = 'You cannot change the status of your own account.';
            }

            statusToggle.onchange = async () => {
                const newStatus = statusToggle.checked ? 'active' : 'inactive';

                if (newStatus === 'inactive') {
                    if (!await showConfirmationDialog('Are you sure you want to make this account inactive? The user will not be able to log in.')) {
                        statusToggle.checked = true; // Revert the toggle change
                        return;
                    }
                }

                statusToggle.disabled = true;
                try {
                    const result = await apiRequest('admins/update.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ admin_id: adminId, status: newStatus }),
                    });
                    toast(result.message);
                    statusLabel.textContent = `Account is ${newStatus === 'active' ? 'Active' : 'Inactive'}`;
                } catch (error) { toast(error.message); } finally { statusToggle.disabled = false; }
            };
        } catch (error) { toast(error.message); navigate('manage-admins'); }

        const passwordForm = $('#password-reset-form');
        if (passwordForm) {
            const notice = $('#password-reset-notice', passwordForm);

            if (adminId === currentUser.id) {
                passwordForm.style.display = 'none';
            }

            passwordForm.onsubmit = async (event) => {
                event.preventDefault();
                const newPassword = passwordForm.elements.new_password.value;
                const confirmPassword = passwordForm.elements.confirm_password.value;

                if (newPassword !== confirmPassword) {
                    toast('The new passwords do not match.');
                    return;
                }

                if (!await showConfirmationDialog('Are you sure you want to update this administrator\'s password? This action cannot be undone.')) {
                    return;
                }

                const submitButton = passwordForm.querySelector('[type="submit"]');
                submitButton.disabled = true;

                try {
                    const result = await apiRequest('admins/update-password.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ admin_id: adminId, password: newPassword }),
                    });
                    toast(result.message);
                    passwordForm.reset();
                } catch (error) {
                    toast(error.message);
                } finally { submitButton.disabled = false; }
            };
        }
    }

    async function accountPage() {
        const form = $('#change-password-form');
        if (!form) return;

        // Reusable function to toggle password visibility
        const setupPasswordReveal = (field) => {
            const input = field.querySelector('input[type="password"]');
            const button = field.querySelector('.password-reveal');
            if (!input || !button) return;

            button.addEventListener('click', () => {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                button.setAttribute('aria-pressed', String(isPassword));
                button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
            });
        };

        // Apply the toggle to all password fields in the form
        $$('.password-field', form).forEach(setupPasswordReveal);

        form.onsubmit = async (event) => {
            event.preventDefault();
            const newPassword = form.elements.new_password.value;
            const confirmPassword = form.elements.confirm_password.value;

            if (newPassword !== confirmPassword) {
                toast('The new passwords do not match.');
                return;
            }

            if (!await showConfirmationDialog('Are you sure you want to change your password?')) {
                return;
            }

            const submitButton = form.querySelector('[type="submit"]');
            submitButton.disabled = true;

            try {
                const result = await apiRequest('admins/update-password.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        current_password: form.elements.current_password.value,
                        new_password: newPassword,
                    }),
                });
                toast(result.message);
                form.reset();
                // Reset password field types to 'password'
                $$('input[type="text"]', form).forEach(input => {
                    if (input.name.includes('password')) input.type = 'password';
                });
            } catch (error) {
                toast(error.message);
            } finally {
                submitButton.disabled = false;
            }
        };
    }

    // Handler for the "Report Issue" page. Attach submit/cancel handlers
    // using the app's apiRequest, toast and navigate functions (all in-scope).
    function reportIssue() {
        const form = $('#report-issue-form');
        if (!form) return;

        const cancel = $('#cancel-report');
        cancel?.addEventListener('click', () => navigate('dashboard'));

        form.onsubmit = async event => {
            event.preventDefault();
            if (!form.reportValidity()) return;

            const data = new FormData(form);
            const payload = {
                issue_type: (data.get('issue_type') || '').toString(),
                severity: (data.get('severity') || '').toString(),
                affected_feature: (data.get('affected_feature') || '').toString(),
                steps: (data.get('steps') || '').toString(),
                additional: (data.get('additional') || '').toString()
            };

            const submitButton = form.querySelector('[type="submit"]');
            if (submitButton) submitButton.disabled = true;

            try {
                // apiRequest sends cookies (session) so backend will attach the reporter identity
                const result = await apiRequest('issues/create.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                toast(result.message || 'Report submitted.');
                navigate('dashboard');
            } catch (error) {
                toast(error.message || 'Unable to submit report.');
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        };

        if (!isLoggedIn()) {
            // Encourage login since the reporter identity is taken from session
            toast('Please log in so your email is attached to the report for follow-up.');
        }
    }

    function locate(done, options = {}) {
        if (!navigator.geolocation) {
            locationSource = 'Unsupported';
            if ($('#location-source')) $('#location-source').textContent = locationSource;
            toast('Geolocation is not supported.');
            return;
        }

        locationSource = 'Requesting GPS';
        if ($('#location-source')) $('#location-source').textContent = locationSource;
        $('#gps-button').textContent = 'GPS: Locating...';
        navigator.geolocation.getCurrentPosition(
            position => {
                locationSource = 'Browser GPS';
                if ($('#location-source')) $('#location-source').textContent = locationSource;
                $('#gps-button').textContent = 'GPS: Active';
                done?.(position);
                focusLocation(position, options);
            },
            () => {
                locationSource = 'Unavailable';
                if ($('#location-source')) $('#location-source').textContent = locationSource;
                $('#gps-button').textContent = 'GPS: Unavailable';
                toast('Location access was denied or unavailable.');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    function welcome() {
        const isAuth = isLoggedIn();
        const displayName = isAuth ? (currentUser?.name || 'Administrator') : 'Guest';
        const displayRole = isAuth
            ? (currentUser?.role === 'superadmin' ? 'Superadmin' : 'Administrator')
            : 'Public Access';
        const roleClass = currentUser?.role === 'superadmin'
            ? 'role-superadmin'
            : (currentUser?.role === 'admin' ? 'role-admin' : 'role-guest');

        $$('.user-name-display, #welcome-user').forEach(el => {
            el.textContent = displayName;
        });

        $$('.user-role-badge, #user-role-label').forEach(el => {
            el.textContent = displayRole;
            el.classList.remove('role-admin', 'role-superadmin', 'role-guest');
            el.classList.add(roleClass);
        });

        $$('.topbar-user-info').forEach(el => {
            el.classList.toggle('hidden', !isAuth);
        });
    }

    function applyRoleVisibility() {
        $$('[data-admin-only]').forEach(element => {
            element.classList.toggle('hidden', !isAdmin());
        });
        $$('[data-superadmin-only]').forEach(element => {
            element.classList.toggle('hidden', !isSuperadmin());
        });

        // Ensure ONLY ONE button is visible at all times
        $$('.login-btn, #login-trigger, #drawer-login-trigger').forEach(btn => {
            btn.classList.toggle('hidden', isLoggedIn());
        });
        $$('.logout-btn, #logout-button, #drawer-logout-button').forEach(btn => {
            btn.classList.toggle('hidden', !isLoggedIn());
        });
    }

    $$('.menu li').forEach(item => {
        item.onclick = () => navigate(item.dataset.page);
    });

    $('.menu-toggle')?.addEventListener('click', () => {
        $('.menu')?.classList.toggle('open');
        $('.sidebar-footer')?.classList.toggle('open');
    });
    $('#close-tree-popup')?.addEventListener('click', () => $('.tree-popup').classList.add('hidden'));
    $('#tree-photo-trigger')?.addEventListener('click', openTreePhoto);
    $('#close-photo-viewer')?.addEventListener('click', closeTreePhoto);
    $('#photo-viewer-dialog')?.addEventListener('click', event => {
        if (event.target === event.currentTarget || event.target.classList.contains('photo-viewer-content')) {
            closeTreePhoto();
        }
    });
    $('#gps-button')?.addEventListener('click', () => locate());
    $$('.login-btn, #login-trigger, #drawer-login-trigger').forEach(trigger => {
        trigger.addEventListener('click', showLoginScreen);
    });
    // Show the report dialog when the topbar button is clicked. If the dialog
    // is not available, fall back to the full report page.
    $('.issue-btn')?.addEventListener('click', () => {
        const dlg = $('#issue-dialog');
        if (dlg && typeof dlg.showModal === 'function') {
            dlg.showModal();
        } else {
            navigate('report-issue');
        }
    });

    // Wire the issue dialog form to the issues API.
    const issueForm = $('#issue-form');
    if (issueForm) {
        $('#cancel-issue')?.addEventListener('click', () => $('#issue-dialog')?.close());
        issueForm.onsubmit = async event => {
            event.preventDefault();
            if (!issueForm.reportValidity()) return;
            const type = $('#issue-type')?.value || '';
            const details = $('#issue-details')?.value || '';
            const submitButton = issueForm.querySelector('[type="submit"]');
            if (submitButton) submitButton.disabled = true;

            if (!isLoggedIn()) {
                // Allow anonymous submissions, but encourage login so the superadmin can follow up.
                toast('You may submit anonymously; log in if you want us to contact you about follow-up.');
            }
            try {
                await apiRequest('issues/create.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ issue_type: type, severity: 'Not specified', affected_feature: '', steps: '', additional: details })
                });
                toast('Report submitted.');
                $('#issue-dialog')?.close();
            } catch (err) {
                toast(err.message || 'Could not submit report.');
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        };
    }

    function openResubmitDialog() {
        if (!selectedTreeForResubmit || selectedTreeForResubmit.operationalStatus !== 'Completed') {
            return;
        }
        const dialog = $('#resubmit-dialog');
        const form   = $('#resubmit-form');
        if (!dialog || !form) return;

        form.reset();

        const tree = selectedTreeForResubmit;
        const treeInfoEl = $('#resubmit-tree-info');
        if (treeInfoEl) {
            const speciesName = tree.species?.commonName || 'Tree';
            const locationStr = tree.address || locationForTree(tree);
            treeInfoEl.textContent = `${speciesName} · ${locationStr}`;
        }

        const idInput = $('#resubmit-tree-id');
        if (idInput) idInput.value = tree.treeId;

        const latInput = $('#resubmit-latitude');
        if (latInput) latInput.value = tree.latitude;

        const lonInput = $('#resubmit-longitude');
        if (lonInput) lonInput.value = tree.longitude;

        const addrInput = $('#resubmit-address');
        if (addrInput) addrInput.value = tree.address || '';

        const areaInput = $('#resubmit-area-type');
        if (areaInput) areaInput.value = tree.areaType || 'Public';

        // Restrict 'Move' to admins
        const moveOption = $('#resubmit-move-option');
        if (moveOption) {
            moveOption.style.display = isAdmin() ? '' : 'none';
        }

        // Show guest fields only if not logged in
        const guestFields = $('#resubmit-guest-fields');
        if (guestFields) {
            guestFields.classList.toggle('hidden', isLoggedIn());
        }

        dialog.showModal();
    }

    const resubmitForm = $('#resubmit-form');
    if (resubmitForm) {
        $('#cancel-resubmit')?.addEventListener('click', () => $('#resubmit-dialog')?.close());
        $('#resubmit-tree-btn')?.addEventListener('click', openResubmitDialog);

        resubmitForm.onsubmit = async event => {
            event.preventDefault();
            if (!resubmitForm.reportValidity()) return;

            const submitBtn = resubmitForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const formData = new FormData(resubmitForm);
                const photoInput = $('#resubmit-photo-input');
                const photoFile  = photoInput?.files?.[0] || null;

                const result = await saveTreeToDatabase({
                    treeId:          formData.get('tree_id'),
                    actionType:      formData.get('action_type'),
                    priority:        formData.get('priority'),
                    reason:          formData.get('reason')?.trim(),
                    address:         formData.get('address')?.trim(),
                    areaType:        formData.get('area_type') || 'Public',
                    lat:             Number(formData.get('latitude')),
                    lon:             Number(formData.get('longitude')),
                    reporterName:    formData.get('reporter_name')?.trim() || null,
                    reporterContact: formData.get('reporter_contact')?.trim() || null,
                    status:          selectedTreeForResubmit?.status || 'Healthy',
                    photo:           photoFile,
                });

                $('#resubmit-dialog')?.close();
                $('.tree-popup')?.classList.add('hidden');

                await loadDatabaseTrees();
                markers();

                const isApproved = result?.approvalStatus === 'Approved';
                showMapNotification(
                    'Request Submitted',
                    isApproved
                        ? 'Your request has been approved and appears on the map.'
                        : 'Your action request has been submitted and is awaiting superadmin review.'
                );
                toast('Action request submitted successfully.');
            } catch (error) {
                toast(error.message || 'Could not submit request.');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        };
    }

    $('#cancel-login')?.addEventListener('click', () => $('#login-dialog').close());

    setupThemeToggle();
    setupLoginForm();
    setupLogoutButton();


    async function bootApp() {
        await checkAuth();

        // Public visitors are never gated behind login — only role-restricted
        // actions (Add Tree, account management) check auth individually.
        showApp();
        applyRoleVisibility();
        welcome();

        try {
            await loadDatabaseTrees();
            if (isLoggedIn()) {
                await loadProfile();
                await loadMyContributions();
            }
        } catch (error) {
            toast(`Database data could not be loaded: ${error.message}`);
        }

        try {
            await loadBoundaryData();
        } catch {
            toast('Barangay boundaries could not be loaded. Barangay filters may be unavailable.');
        }

        await navigate('map');
    }

    await bootApp();
})();
