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
        settings: 'Settings'
    };

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

    // Barangay boundary polygons, populated once Overpass data loads.
    let barangayPolygons = [];

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
    }

    function setupLogoutButton() {
        const button = $('#logout-button');
        if (!button) return;

        button.onclick = async () => {
            try {
                await logout();
                databaseContributions = [];
                applyRoleVisibility(); // hides admin-only nav items again
                welcome(); // now shows "Welcome, Guest"
                const activePage = $('.menu li.active')?.dataset.page;
                if (['contributions', 'review-contributions', 'manage-admins', 'settings'].includes(activePage)) {
                    await navigate('dashboard');
                } else if (activePage === 'dashboard') {
                    setupDashboard();
                }
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

    // --- Profile ---------------------------------------------------------------

    async function loadProfile() {
        const result = await apiRequest('profile.php');
        currentUser = { ...currentUser, ...result.profile };
    }

    // --- Point-in-polygon barangay lookup -----------------------------------

    function pointInRing(lat, lon, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [latI, lonI] = ring[i];
            const [latJ, lonJ] = ring[j];
            const intersects = ((lonI > lon) !== (lonJ > lon))
                && (lat < (latJ - latI) * (lon - lonI) / (lonJ - lonI) + latI);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function barangayForPoint(lat, lon) {
        const match = barangayPolygons.find(polygon => pointInRing(lat, lon, polygon.ring));
        return match ? match.name : 'Unmapped';
    }

    function locationForTree(tree) {
        return barangayForPoint(tree.latitude, tree.longitude);
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
            const response = await fetch(`${apiBaseUrl}boundaries.php`);
            if (!response.ok) throw new Error('Boundary request failed');

            const data = await response.json();
            const relations = data.elements
                ?.filter(element => element.type === 'relation') || [];
            if (!relations.length) throw new Error('Boundary response was empty');

            const pasigBounds = L.latLngBounds([]);
            boundaryLayer.clearLayers();
            barangayPolygons = [];

            relations.forEach(relation => drawBoundary(relation, pasigBounds));

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

    function drawBoundary(relation, pasigBounds) {
        const isPasigCity = relation.tags?.admin_level === '6';
        const style = {
            color: isPasigCity ? '#1769aa' : '#2f8f46',
            weight: isPasigCity ? 5 : 2,
            opacity: isPasigCity ? 0.95 : 0.85,
            fill: false
        };

        const ringPoints = [];

        relation.members
            ?.filter(member => member.type === 'way' && member.geometry?.length)
            .forEach(member => {
                const coordinates = member.geometry.map(point => [point.lat, point.lon]);
                const line = L.polyline(coordinates, style)
                    .addTo(boundaryLayer)
                    .bindPopup(isPasigCity ? 'Pasig City boundary' : `${relation.tags?.name || 'Barangay'} boundary`);

                if (isPasigCity) {
                    pasigBounds.extend(line.getBounds());
                } else {
                    ringPoints.push(...coordinates);
                }
            });

        if (!isPasigCity && ringPoints.length) {
            barangayPolygons.push({
                name: relation.tags?.name || 'Barangay',
                ring: ringPoints
            });
        }
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
    }

    function requestStartupLocation() {
        if (startupLocationRequested) return;
        startupLocationRequested = true;
        locate(null, { startup: true });
    }

    function showTree(tree, location) {
        const image = $('#tree-img');
        image.onerror = () => {
            image.onerror = null;
            image.src = 'trees/mango.jpg';
        };
        image.src = tree.photo || 'trees/mango.jpg';
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

        $('.tree-popup').classList.remove('hidden');
    }

    // --- Map search / filter bar ---------------------------------------------

    function populateMapFilters() {
        const statusFilter = $('#map-status-filter');
        const locationFilter = $('#map-location-filter');
        if (!statusFilter || !locationFilter) return;

        const currentStatus = statusFilter.value;
        const currentLocation = locationFilter.value;

        const statuses = [...new Set(trees().map(tree => tree.status).filter(Boolean))].sort();
        const locations = [...new Set([...treeMarkers.values()].map(entry => entry.location))].sort();

        statusFilter.innerHTML = '<option value="">All Status</option>'
            + statuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('');

        locationFilter.innerHTML = '<option value="">All Barangays</option>'
            + locations.map(location => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('');

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

        treeMarkers.forEach(({ marker, tree, location: treeLocation }) => {
            const haystack = `${tree.species.commonName} ${tree.species.scientificName}`.toLowerCase();
            const matchesQuery = !query || haystack.includes(query);
            const matchesStatus = !status || tree.status === status;
            const matchesLocation = !location || treeLocation === location;
            const matches = matchesQuery && matchesStatus && matchesLocation;

            marker.setOpacity(!hasActiveFilter || matches ? 1 : 0.25);
            marker.setZIndexOffset(matches && hasActiveFilter ? 1000 : 0);
        });
    }

    function setupMapFilters() {
        const searchInput = $('#map-species-search');
        const statusFilter = $('#map-status-filter');
        const locationFilter = $('#map-location-filter');
        if (!searchInput || !statusFilter || !locationFilter) return;

        populateMapFilters();

        searchInput.oninput = applyMapFilters;
        statusFilter.onchange = applyMapFilters;
        locationFilter.onchange = applyMapFilters;
    }

    // --- Navigation ------------------------------------------------------------

    async function navigate(page) {
        if (['contributions', 'settings'].includes(page) && !isAdmin()) {
            toast('Admin login is required to open that page.');
            return;
        }

        if (['review-contributions', 'manage-admins'].includes(page) && !isSuperadmin()) {
            toast('Superadmin access is required to open that page.');
            return;
        }

        // "Add Tree" is admin/superadmin only.
        if (page === 'add-tree' && !canSubmitTrees()) {
            toast('You do not have permission to submit trees.');
            return;
        }

        $$('.menu li').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        $('.menu').classList.remove('open');
        $('#page-title').textContent = pageTitles[page] || 'GreenMap';

        if (page === 'map') {
            $('#map-area').hidden = false;
            $('#panel').classList.add('hidden');
            initMap();
            setTimeout(() => map?.invalidateSize(), 50);
            return;
        }

        $('#map-area').hidden = true;
        const panel = $('#panel');
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
        }
    }

    function setup(page) {
        if (page === 'add-tree') addTree();
        if (page === 'contributions') contributions();
        if (page === 'review-contributions') reviewContributions();
        if (page === 'manage-admins') manageAdmins();
        if (page === 'settings') settings();

        if (page === 'dashboard') {
            setupDashboard();
        }
    }

    function contributionsByCurrentAdmin() {
        return isAdmin() ? databaseContributions : [];
    }

    function setupDashboard() {
        const allTrees = trees();
        const myTrees = contributionsByCurrentAdmin();

        $('#total-trees').textContent = allTrees.length;
        $('#species-total').textContent = new Set(allTrees.map(tree => tree.species.speciesId)).size;
        if ($('#my-trees')) $('#my-trees').textContent = myTrees.length;
        if ($('#location-source')) $('#location-source').textContent = locationSource;

        renderSpeciesChart(allTrees);
        renderStatusChart(allTrees);
        renderActivityList($('#recent-activity'), allTrees, 'No tree activity has been recorded yet.');
        renderActivityList($('#dashboard-contributions'), myTrees, 'You have no approved contributions yet.');

        const reportButton = $('#generate-report');
        if (reportButton) reportButton.onclick = generateReport;

        applyRoleVisibility();
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

        const records = trees();
        const rows = [
            ['Tree ID', 'Common Name', 'Scientific Name', 'Status', 'Age', 'Latitude', 'Longitude', 'Submitted At', 'Added By'],
            ...records.map(tree => [
                tree.treeId,
                tree.species.commonName,
                tree.species.scientificName,
                tree.status,
                tree.age,
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
        link.download = `greenmap-tree-report-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        toast(`Report generated with ${records.length} tree record${records.length === 1 ? '' : 's'}.`);
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

                await loadMyContributions();
                if (result.approvalStatus === 'Approved') {
                    await loadDatabaseTrees();
                }
                toast(result.message);
                await navigate('contributions');
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
                            <span class="role-badge role-${admin.role}">${escapeHtml(admin.role)}</span>
                        </article>
                    `).join('')
                    : '<div class="dashboard-empty compact-empty">No administrator accounts found.</div>';
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

    function settings() {
        const nameEl = $('#profile-name');
        const roleEl = $('#profile-role');
        if (nameEl) nameEl.textContent = currentUser?.name || '';
        if (roleEl) roleEl.textContent = currentUser?.role || '';
        // Profile is read-only for now — no phone/email/notification fields
        // exist in the current users table.
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
    $('#gps-button')?.addEventListener('click', () => locate());
    $('#login-trigger')?.addEventListener('click', showLoginScreen);
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

        await navigate('dashboard');
    }

    await bootApp();
})();
