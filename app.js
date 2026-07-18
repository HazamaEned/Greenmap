(async () => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const config = window.GREENMAP_CONFIG || {};
    const pageExtension = config.pageExtension || 'html';
    const apiBaseUrl = config.apiBaseUrl || 'backend/server/api/';
    const pageTitles = {
        dashboard: 'Dashboard',
        map: 'Map',
        'add-tree': 'Add Tree',
        contributions: 'My Contributions',
        'review-contributions': 'Review Contributions',
        'manage-admins': 'Manage Admins',
        'edit-admin': 'Edit Admin',
        'account': 'My Account',
        'report-issue': 'Report Issue',
        'report-details': 'Report Details'
    };
    pageTitles['reports'] = 'Issue Reports'; // Add new page title
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
    let startupLocationRequested = false;
    let databaseTrees = [];
    let databaseContributions = [];
    let speciesList = [];
    let pendingLocation = null;
    let currentUser = null; // { name, role } or null if not logged in
    let locationSource = 'Not requested';
    let selectedTreePhotoUrl = '';
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

    const treeIcon = () => L.divIcon({
        className: 'greenmap-marker greenmap-tree-marker',
        html: '<span aria-hidden="true">&#127794;</span>',
        iconSize: [34, 34],
        iconAnchor: [17, 32],
        popupAnchor: [0, -30]
    });

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
        const response = await fetch(`${apiBaseUrl}${path}`, {
            credentials: 'include', // required so PHP session cookies are sent
            ...options
        });
        const result = await response.json().catch(() => null);

        if (!response.ok || !result?.success) {
            throw new Error(result?.message || 'The database request failed.');
        }

        return result;
    }

    // --- Auth --------------------------------------------------------------

    async function checkAuth() {
        try {
            const result = await apiRequest('authentication/me.php');
            currentUser = result.loggedIn ? result.user : null;
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
        currentUser = result.user;
    }

    async function logout() {
        await apiRequest('authentication/logout.php', { method: 'POST' });
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
        const button = $('#logout-button');
        if (!button) return;

        button.onclick = async () => {
            try {
                await logout();
                databaseContributions = [];
                applyRoleVisibility(); // Hides admin-only nav items again.
                welcome(); // Now shows "Welcome, Guest".
                await navigate('dashboard');
                toast('Logged out.');
            } catch (error) {
                toast(error.message);
            }
        };
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
        if (tree.speciesId) body.append('species_id', tree.speciesId);
        if (tree.commonName) body.append('common_name', tree.commonName);
        if (tree.scientificName) body.append('scientific_name', tree.scientificName);
        if (tree.originStatus) body.append('origin_status', tree.originStatus);
        if (tree.description) body.append('description', tree.description);
        body.append('tree_status', tree.status || 'Healthy');
        if (tree.age !== null) body.append('tree_age', tree.age);
        body.append('latitude', tree.lat);
        body.append('longitude', tree.lon);
        if (tree.photo) body.append('tree_photo', tree.photo);

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

    async function reviewSubmission(submissionId, decision) {
        return apiRequest('reviews/update.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                submission_id: submissionId,
                decision,
            }),
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

        map.on('click', event => {
            if (!canSubmitTrees()) return;
            pendingLocation = {
                lat: event.latlng.lat,
                lon: event.latlng.lng
            };
            toast('Location selected. Open My Contributions, then Add Tree, to use it.');
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
            const marker = L.marker([tree.latitude, tree.longitude], {
                icon: treeIcon(),
                title: tree.species.commonName
            })
                .addTo(treeLayer)
                .bindPopup(`
                    <strong>${escapeHtml(tree.species.commonName)}</strong><br>
                    <em>${escapeHtml(tree.species.scientificName)}</em><br>
                    <small>${escapeHtml(tree.status)} &middot; ${escapeHtml(location)}</small>
                `)
                .on('click', () => showTree(tree, location));

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
        selectedTreePhotoUrl = tree.photo || '';

        if (selectedTreePhotoUrl) {
            image.src = selectedTreePhotoUrl;
            image.alt = `${tree.species.commonName} tree`;
            trigger.style.display = '';
        } else {
            image.src = '';
            image.alt = 'No photo available';
            trigger.style.display = 'none';
        }
        $('#tree-name').textContent = tree.species.commonName;
        $('#tree-species').textContent = `Scientific name: ${tree.species.scientificName}`;
        $('#tree-planted').textContent = tree.age !== null ? `Age: ${tree.age} years` : 'Age: Unknown';

        const statusEl = $('#tree-status');
        if (statusEl) statusEl.textContent = `Status: ${tree.status}`;

        const locationEl = $('#tree-location');
        if (locationEl) locationEl.textContent = `Barangay: ${location || locationForTree(tree)}`;

        const addedByEl = $('#tree-addedby');
        const addedBy = tree.addedBy || tree.submittedBy?.name || currentUser?.name || 'Unknown';
        if (addedByEl) addedByEl.textContent = `Added by: ${addedBy}`;

        const streetViewLink = $('#view-streetview');
        if (streetViewLink) {
            const coordinates = encodeURIComponent(`${tree.latitude},${tree.longitude}`);
            streetViewLink.href = `https://www.instantstreetview.com/s/${coordinates}`;
        }

        $('.tree-popup').classList.remove('hidden');
    }

    function openTreePhoto() {
        const source = $('#tree-img');
        const fullscreenImage = $('#fullscreen-tree-img');
        const dialog = $('#photo-viewer-dialog');
        if (!source || !fullscreenImage || !dialog) return;

        fullscreenImage.onerror = null;
        fullscreenImage.src = selectedTreePhotoUrl || source.src;
        fullscreenImage.alt = source.alt || 'Tree photo';
        if (fullscreenImage.src) {
            dialog.showModal();
        }
    }

    function closeTreePhoto() {
        $('#photo-viewer-dialog')?.close();
    }

    // --- Map search / filter bar ---------------------------------------------

    function populateMapFilters() {
        const statusFilter = $('#map-status-filter');
        const locationFilter = $('#map-location-filter');
        if (!statusFilter || !locationFilter) return;

        const currentStatus = statusFilter.value;
        const currentLocation = locationFilter.value;

        const statuses = ['Healthy', 'Diseased', 'Dead', 'Removed'];
        const locations = PASIG_BARANGAYS;

        statusFilter.innerHTML = '<option value="">All Status</option>'
            + statuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('');

        locationFilter.innerHTML = '<option value="">All Barangays</option>'
            + [...locations].sort().map(location => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('');

        if ([...statusFilter.options].some(option => option.value === currentStatus)) {
            statusFilter.value = currentStatus;
        }
        if ([...locationFilter.options].some(option => option.value === currentLocation)) {
            locationFilter.value = currentLocation;
        }
    }

    function applyMapFilters() {
        const searchInput = $('#map-species-search');
        const statusFilter = $('#map-status-filter');
        const locationFilter = $('#map-location-filter');
        if (!searchInput || !statusFilter || !locationFilter) return;

        const query = searchInput.value.toLowerCase().trim();
        const status = statusFilter.value;
        const location = locationFilter.value;
        const hasActiveFilter = Boolean(query || status || location);
        let matchCount = 0;

        treeMarkers.forEach(({ marker, tree, location: treeLocation }) => {
            const haystack = `${tree.species.commonName} ${tree.species.scientificName}`.toLowerCase();
            const matchesQuery = !query || haystack.includes(query);
            const matchesStatus = !status || tree.status === status;
            const matchesLocation = !location || treeLocation === location;
            const matches = matchesQuery && matchesStatus && matchesLocation;

            if (matches) {
                matchCount++;
            }

            marker.setOpacity(!hasActiveFilter || matches ? 1 : 0.25);
            marker.setZIndexOffset(matches && hasActiveFilter ? 1000 : 0);
        });

        const noResultsOverlay = $('#map-no-results') || document.createElement('div');
        noResultsOverlay.id = 'map-no-results';
        noResultsOverlay.className = 'map-no-results-overlay';
        noResultsOverlay.innerHTML = '<strong>No trees match your filter</strong><small>Try adjusting your search criteria.</small>';

        // Clear any existing removal timer
        if (noResultsOverlay.timer) {
            clearTimeout(noResultsOverlay.timer);
            noResultsOverlay.timer = null;
        }

        if (hasActiveFilter && matchCount === 0) {
            if (!noResultsOverlay.parentNode) {
                map?.getContainer().appendChild(noResultsOverlay);
            }
            // Set a timer to remove the overlay
            noResultsOverlay.timer = setTimeout(() => {
                noResultsOverlay.parentNode?.removeChild(noResultsOverlay);
            }, 2500);
        } else if (noResultsOverlay.parentNode === map?.getContainer()) {
            map.getContainer().removeChild(noResultsOverlay);
        }

        // If a barangay was selected and there are results, pan and zoom to it.
        if (location && map) {
            const barangayFeature = boundaryData?.barangays?.features.find(
                feature => (feature.properties?.name || '') === location
            );

            if (barangayFeature) {
                // Create a temporary GeoJSON layer to calculate its bounds
                const tempLayer = L.geoJSON(barangayFeature);
                map.fitBounds(tempLayer.getBounds(), { padding: [40, 40] });
            }
        } else if (map && !query && !status) {
            // If all filters are cleared, reset the view to the whole city
            const cityBounds = boundaryLayer?.getBounds();
            if (cityBounds?.isValid()) map.fitBounds(cityBounds, { padding: [35, 35] });
        }
    }

    function setupMapFilters() {
        const searchInput = $('#map-species-search');
        const statusFilter = $('#map-status-filter');
        const locationFilter = $('#map-location-filter');
        if (!searchInput || !statusFilter || !locationFilter) return;

        populateMapFilters();

        const searchContainer = $('.map-search');
        if (searchContainer && !searchContainer.querySelector('.clear-filters-btn')) {
            const clearButton = document.createElement('button');
            clearButton.type = 'button';
            clearButton.className = 'map-filter-action clear-filters-btn';
            clearButton.title = 'Clear all filters';
            clearButton.innerHTML = '&#x2715;'; // A simple 'X' icon

            clearButton.onclick = () => {
                searchInput.value = '';
                statusFilter.value = '';
                locationFilter.value = '';
                applyMapFilters();
            };

            searchContainer.appendChild(clearButton);
        }

        searchInput.oninput = applyMapFilters;
        statusFilter.onchange = applyMapFilters;
        locationFilter.onchange = applyMapFilters;
    }

    // --- Navigation ------------------------------------------------------------

    async function navigate(page, state = {}) {
        if (page === 'contributions' && !isAdmin()) {
            toast('Admin login is required to open that page.');
            return;
        }

        // The edit-admin page is also superadmin-only.
        if (['review-contributions', 'manage-admins', 'reports', 'edit-admin'].includes(page) && !isSuperadmin()) {
            toast('Superadmin access is required to open that page.');
            return;
        }

        // "Add Tree" is admin/superadmin only.
        if (page === 'add-tree' && !canSubmitTrees()) {
            toast('You do not have permission to submit trees.');
            return;
        }

        currentPageState = state;

        $$('.menu li').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        $('.menu').classList.remove('open');
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
        const allTrees = recordsForBarangay(trees());
        const myTrees = recordsForBarangay(contributionsByCurrentAdmin());

        $('#total-trees').textContent = allTrees.length;
        $('#species-total').textContent = new Set(allTrees.map(tree => tree.species.speciesId)).size;
        if ($('#my-trees')) $('#my-trees').textContent = myTrees.length;
        if ($('#location-source')) $('#location-source').textContent = locationSource;

        renderSpeciesChart(allTrees);
        renderStatusChart(allTrees);
        renderActivityList($('#recent-activity'), allTrees, 'No tree activity has been recorded yet.');
        renderActivityList($('#dashboard-contributions'), myTrees, 'You have no approved contributions yet.');
    }

    function renderSpeciesChart(allTrees) {
        const chart = $('#species-chart');
        if (!chart) return;

        const totals = new Map();
        allTrees.forEach(tree => {
            const name = tree.species.commonName;
            totals.set(name, (totals.get(name) || 0) + 1);
        });

        const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
        if (!entries.length) {
            chart.innerHTML = '<div class="dashboard-empty"><strong>No species data</strong><small>Species totals will appear when trees are approved.</small></div>';
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

    function renderStatusChart(allTrees) {
        const chart = $('#status-chart');
        const legend = $('#status-legend');
        if (!chart || !legend) return;

        const colors = {
            Healthy: '#3e9b66',
            Diseased: '#d49b36',
            Dead: '#b95454',
            Removed: '#77827b',
        };
        const totals = new Map();
        allTrees.forEach(tree => totals.set(tree.status, (totals.get(tree.status) || 0) + 1));
        const entries = [...totals.entries()];
        const overall = allTrees.length;

        if (!overall) {
            chart.style.background = 'var(--surface-soft)';
            legend.innerHTML = '<li><span></span><span>No status data</span><strong>0</strong></li>';
            return;
        }

        let cursor = 0;
        const segments = entries.map(([status, total]) => {
            const start = cursor;
            cursor += total / overall * 100;
            return `${colors[status] || '#5f8fa8'} ${start}% ${cursor}%`;
        });
        chart.style.background = `conic-gradient(${segments.join(',')})`;
        legend.innerHTML = entries.map(([status, total]) => `
            <li>
                <i style="background:${colors[status] || '#5f8fa8'}"></i>
                <span>${escapeHtml(status)}</span>
                <strong>${total}</strong>
            </li>
        `).join('');
    }

    function renderActivityList(list, records, emptyMessage) {
        if (!list) return;
        list.innerHTML = records.length
            ? records.slice(0, 5).map(tree => {
                const submitted = tree.submittedAt
                    ? new Date(tree.submittedAt.replace(' ', 'T')).toLocaleDateString()
                    : 'Date unavailable';
                const status = tree.approvalStatus || tree.status;
                return `<li><span>${escapeHtml(tree.species.commonName)}</span><small>${escapeHtml(status)} &middot; ${escapeHtml(submitted)}</small></li>`;
            }).join('')
            : `<li><span>No recent activity</span><small>${escapeHtml(emptyMessage)}</small></li>`;
    }

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
            ['Tree ID', 'Common Name', 'Scientific Name', 'Status', 'Age', 'Barangay', 'Latitude', 'Longitude', 'Submitted At', 'Added By'],
            ...records.map(tree => [
                tree.treeId,
                tree.species.commonName,
                tree.species.scientificName,
                tree.status,
                tree.age,
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
        link.download = `greenmap-tree-report${barangaySuffix}-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        const scope = dashboardBarangayFilter || 'all barangays';
        toast(`Report generated for ${scope} with ${records.length} tree record${records.length === 1 ? '' : 's'}.`);
    }

    async function addTree() {
        const form = $('#add-tree-form');
        if (!form) return;

        const speciesSelect = $('#species-select', form);
        const newSpeciesFields = $('#new-species-fields', form);

        const toggleNewSpecies = () => {
            const addsNewSpecies = speciesSelect.value === 'new';
            newSpeciesFields.classList.toggle('hidden', !addsNewSpecies);
            ['common_name', 'scientific_name', 'origin_status'].forEach(name => {
                const input = form.elements[name];
                if (input) input.required = addsNewSpecies;
            });
        };

        if (pendingLocation) {
            form.latitude.value = pendingLocation.lat.toFixed(6);
            form.longitude.value = pendingLocation.lon.toFixed(6);
            pendingLocation = null;
        }

        try {
            await loadSpeciesList();
            populateSpeciesSelect(speciesSelect);
        } catch (error) {
            speciesSelect.innerHTML = '<option value="new">+ Add a new species</option>';
            speciesSelect.value = 'new';
            toast(`Could not load species list: ${error.message}`);
        }

        speciesSelect.onchange = toggleNewSpecies;
        toggleNewSpecies();

        const inlineRegion = form.closest('#contribution-form-region');
        const cancel = () => {
            if (!inlineRegion) {
                navigate('contributions');
                return;
            }

            inlineRegion.innerHTML = '';
            inlineRegion.classList.add('hidden');
            $('#add-contribution')?.classList.remove('hidden');
        };
        $('#cancel-contribution')?.addEventListener('click', cancel);
        $('#cancel-contribution-bottom')?.addEventListener('click', cancel);

        $('#use-location').onclick = () => locate(position => {
            form.latitude.value = position.coords.latitude.toFixed(6);
            form.longitude.value = position.coords.longitude.toFixed(6);
        });

        form.onsubmit = async event => {
            event.preventDefault();
            if (!form.reportValidity()) return;

            const data = new FormData(form);
            const submitButton = form.querySelector('[type="submit"]');
            submitButton.disabled = true;

            try {
                const selectedSpecies = data.get('species_id');
                const result = await saveTreeToDatabase({
                    speciesId: selectedSpecies !== 'new' ? Number(selectedSpecies) : null,
                    commonName: selectedSpecies === 'new' ? data.get('common_name').trim() : null,
                    scientificName: selectedSpecies === 'new' ? data.get('scientific_name').trim() : null,
                    originStatus: selectedSpecies === 'new' ? data.get('origin_status') : null,
                    description: selectedSpecies === 'new' ? data.get('description').trim() : null,
                    status: data.get('tree_status'),
                    age: data.get('tree_age') ? Number(data.get('tree_age')) : null,
                    lat: Number(data.get('latitude')),
                    lon: Number(data.get('longitude')),
                    photo: data.get('tree_photo')?.size ? data.get('tree_photo') : null,
                });

                // Navigate to the map page first.
                await navigate('map');

                // Now show the success dialog.
                await loadMyContributions();
                showMapNotification('Entry Submitted', 'Wait for an admin to verify.');
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

    const escapeHtml = value => {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    };

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
        $('#contribution-total').textContent = allTrees.length;
        $('#contribution-pending').textContent = countByStatus('Pending');
        $('#contribution-approved').textContent = countByStatus('Approved');
        $('#contribution-rejected').textContent = countByStatus('Rejected');

        const filter = $('#contribution-status-filter');

        const renderRows = () => {
            const visibleTrees = filter.value
                ? allTrees.filter(tree => tree.approvalStatus === filter.value)
                : allTrees;

            body.innerHTML = visibleTrees.length
                ? visibleTrees.map(tree => `
                <tr>
                    <td>
                        <strong>${escapeHtml(tree.species.commonName)}</strong>
                        <small>${escapeHtml(tree.species.scientificName)}</small>
                    </td>
                    <td>${escapeHtml(tree.status)}${tree.age !== null ? `<small>${tree.age} year${tree.age === 1 ? '' : 's'} old</small>` : ''}</td>
                    <td>${tree.submittedAt ? escapeHtml(new Date(tree.submittedAt.replace(' ', 'T')).toLocaleString()) : 'Unavailable'}</td>
                    <td><span class="status-badge status-${tree.approvalStatus.toLowerCase()}">${escapeHtml(tree.approvalStatus)}</span></td>
                    <td>${tree.latitude.toFixed(4)}, ${tree.longitude.toFixed(4)}</td>
                    <td>
                        <button data-view-submission="${tree.submissionId}">View on Map</button>
                    </td>
                </tr>
            `).join('')
                : '<tr><td colspan="6" class="empty-state">No contributions match this status.</td></tr>';

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
        const body = $('#review-contributions-body');
        const filter = $('#review-status-filter');
        if (!body || !filter) return;

        const render = async () => {
            body.innerHTML = '<tr><td colspan="6" class="empty-state">Loading contributions...</td></tr>';

            try {
                const submissions = await loadReviewSubmissions(filter.value);
                const pendingCount = filter.value === 'Pending'
                    ? submissions.length
                    : (await loadReviewSubmissions('Pending')).length;
                $('#pending-review-count').textContent = `${pendingCount} pending`;

                body.innerHTML = submissions.length
                    ? submissions.map(item => {
                        const canReview = item.approvalStatus === 'Pending'
                            && item.submittedBy.id !== currentUser.id;
                        const actions = canReview
                            ? `<button class="approve-action" data-review-id="${item.submissionId}" data-decision="Approved">Approve</button>
                               <button class="danger-link" data-review-id="${item.submissionId}" data-decision="Rejected">Reject</button>`
                            : item.approvalStatus === 'Pending'
                                ? '<small>Cannot review your own contribution</small>'
                                : `<small>Reviewed by ${escapeHtml(item.reviewedBy || 'Superadmin')}</small>`;

                        return `
                            <tr>
                                <td>
                                    <strong>${escapeHtml(item.species.commonName)}</strong>
                                    <small>${escapeHtml(item.species.scientificName)}</small>
                                </td>
                                <td>
                                    ${escapeHtml(item.submittedBy.name)}
                                    <small>${escapeHtml(item.submittedBy.email)}</small>
                                </td>
                                <td>${escapeHtml(item.status)}${item.age !== null ? `<small>${item.age} year${item.age === 1 ? '' : 's'} old</small>` : ''}</td>
                                <td>${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}</td>
                                <td><span class="status-badge status-${item.approvalStatus.toLowerCase()}">${escapeHtml(item.approvalStatus)}</span></td>
                                <td class="review-actions">${actions}</td>
                            </tr>
                        `;
                    }).join('')
                    : '<tr><td colspan="6" class="empty-state">No contributions match this status.</td></tr>';

                $$('[data-review-id]', body).forEach(button => {
                    button.onclick = async () => {
                        const decision = button.dataset.decision;
                        const verb = decision === 'Approved' ? 'approve' : 'reject';
                        if (!confirm(`Are you sure you want to ${verb} this contribution?`)) return;

                        button.disabled = true;
                        try {
                            const result = await reviewSubmission(Number(button.dataset.reviewId), decision);
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
                body.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
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
                                <button class="edit-admin-btn" data-admin-id="${admin.id}">Edit</button>
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
        const el = $('#welcome-user');
        if (el) el.textContent = `Welcome, ${currentUser?.name || 'Guest'}`;
    }

    function applyRoleVisibility() {
        $$('[data-admin-only]').forEach(element => {
            element.classList.toggle('hidden', !isAdmin());
        });
        $$('[data-superadmin-only]').forEach(element => {
            element.classList.toggle('hidden', !isSuperadmin());
        });

        // Toggle login/logout buttons based on auth state.
        $('#login-trigger')?.classList.toggle('hidden', isLoggedIn());
        $('#logout-button')?.classList.toggle('hidden', !isLoggedIn());
    }

    $$('.menu li').forEach(item => {
        item.onclick = () => navigate(item.dataset.page);
    });

    $('.menu-toggle')?.addEventListener('click', () => $('.menu').classList.toggle('open'));
    $('#close-tree-popup')?.addEventListener('click', () => $('.tree-popup').classList.add('hidden'));
    $('#tree-photo-trigger')?.addEventListener('click', openTreePhoto);
    $('#close-photo-viewer')?.addEventListener('click', closeTreePhoto);
    $('#photo-viewer-dialog')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) closeTreePhoto();
    });
    $('#gps-button')?.addEventListener('click', () => locate());
    $('#login-trigger')?.addEventListener('click', showLoginScreen);
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

        await navigate('dashboard');
    }

    await bootApp();
})();
