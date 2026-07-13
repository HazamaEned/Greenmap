(async () => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const config = window.GREENMAP_CONFIG || {};
    const pageExtension = config.pageExtension || 'html';
    const apiBaseUrl = config.apiBaseUrl || 'server/api/';
    const pageTitles = {
        dashboard: 'Dashboard',
        map: 'Map',
        'add-tree': 'Add Tree',
        contributions: 'My Contributions',
        settings: 'Settings'
    };

    let map;
    let treeLayer;
    let boundaryLayer;
    let userMarker;
    let startupLocationRequested = false;
    let databaseTrees = [];
    let speciesList = [];
    let pendingLocation = null;
    let currentUser = null; // { name, role } or null if not logged in

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
    const isSuperadmin = () => currentUser?.role === 'superadmin';

    function toast(message) {
        const element = $('#toast');
        element.textContent = message;
        element.classList.remove('hidden');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => element.classList.add('hidden'), 3000);
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
            const result = await apiRequest('auth/me.php');
            currentUser = result.loggedIn ? result.user : null;
        } catch {
            currentUser = null;
        }
    }

    async function login(email, password) {
        const result = await apiRequest('auth/login.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        currentUser = result.user;
    }

    async function logout() {
        await apiRequest('auth/logout.php', { method: 'POST' });
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
                applyRoleVisibility(); // hides admin-only nav items again
                welcome(); // now shows "Welcome, Guest"
                toast('Logged out.');
            } catch (error) {
                toast(error.message);
            }
        };
    }

    // --- Species -------------------------------------------------------------

    async function loadSpeciesList(query = '') {
        const result = await apiRequest(`species/search.php?q=${encodeURIComponent(query || 'a')}&limit=50`);
        speciesList = result.species;
        return speciesList;
    }

    function populateSpeciesSelect(select) {
        if (!select) return;
        select.innerHTML = '<option value="">Select a species...</option>'
            + speciesList.map(species =>
                `<option value="${species.speciesId}">${escapeHtml(species.commonName)} (${escapeHtml(species.scientificName)})</option>`
            ).join('');
    }

    // --- Trees ---------------------------------------------------------------

    async function saveTreeToDatabase(tree) {
        return apiRequest('submissions/create.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                species_id: tree.speciesId,
                tree_status: tree.status || 'Healthy',
                tree_age: tree.age ?? null,
                tree_photo: tree.photo || null,
                latitude: tree.lat,
                longitude: tree.lon
            })
        });
    }

    async function loadDatabaseTrees() {
        const result = await apiRequest('trees/list.php');
        databaseTrees = result.trees;
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
            toast('Location selected. Open Add Tree to use it.');
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
        $('#tree-img').src = tree.photo || 'trees/mango.jpg';
        $('#tree-name').textContent = tree.species.commonName;
        $('#tree-species').textContent = `Scientific name: ${tree.species.scientificName}`;
        $('#tree-planted').textContent = tree.age !== null ? `Age: ${tree.age} years` : 'Age: Unknown';

        const statusEl = $('#tree-status');
        if (statusEl) statusEl.textContent = `Status: ${tree.status}`;

        const locationEl = $('#tree-location');
        if (locationEl) locationEl.textContent = `Barangay: ${location || locationForTree(tree)}`;

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
            const response = await fetch(`pages/${page}.${pageExtension}`);
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
        if (page === 'settings') settings();

        if (page === 'dashboard') {
            const allTrees = trees();
            $('#total-trees').textContent = allTrees.length;
            $('#species-total').textContent = new Set(allTrees.map(tree => tree.species.speciesId)).size;
        }
    }

    async function addTree() {
        const form = $('#add-tree-form');
        if (!form) return;

        if (pendingLocation) {
            form.latitude.value = pendingLocation.lat.toFixed(6);
            form.longitude.value = pendingLocation.lon.toFixed(6);
            pendingLocation = null;
        }

        // Species select needs the current species list. If your HTML uses
        // <select name="species_id" id="species-select">, this populates it.
        try {
            await loadSpeciesList();
            populateSpeciesSelect($('#species-select', form));
        } catch (error) {
            toast(`Could not load species list: ${error.message}`);
        }

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
                await saveTreeToDatabase({
                    speciesId: Number(data.get('species_id')),
                    status: data.get('status') || 'Healthy',
                    age: data.get('age') ? Number(data.get('age')) : null,
                    lat: Number(data.get('latitude')),
                    lon: Number(data.get('longitude')),
                    photo: null // wire up file upload separately when that endpoint exists
                });

                toast('Tree submitted and is pending admin review.');
                navigate('contributions');
            } catch (error) {
                toast(error.message);
            } finally {
                submitButton.disabled = false;
            }
        };
    }

    const escapeHtml = value => {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    };

    function contributions() {
        // Note: tree_submissions doesn't currently expose "my submissions"
        // filtered by user, so this shows every approved tree for now.
        // A submissions/list.php?mine=1 endpoint would be the real fix.
        const allTrees = trees();
        const body = $('#contributions-body');
        if (!body) return;

        body.innerHTML = allTrees.length
            ? allTrees.map(tree => `
                <tr>
                    <td>${escapeHtml(tree.species.commonName)}</td>
                    <td>${escapeHtml(tree.status)}</td>
                    <td>${tree.latitude.toFixed(4)}, ${tree.longitude.toFixed(4)}</td>
                    <td>
                        <button data-view="${tree.treeId}">View</button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="4" class="empty-state">No trees yet.</td></tr>';

        $$('[data-view]', body).forEach(button => {
            button.onclick = () => {
                const tree = allTrees.find(item => item.treeId == button.dataset.view);
                navigate('map').then(() => {
                    map.setView([tree.latitude, tree.longitude], 18);
                    showTree(tree, locationForTree(tree));
                });
            };
        });
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
            toast('Geolocation is not supported.');
            return;
        }

        $('#gps-button').textContent = 'GPS: Locating...';
        navigator.geolocation.getCurrentPosition(
            position => {
                $('#gps-button').textContent = 'GPS: Active';
                done?.(position);
                focusLocation(position, options);
            },
            () => {
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
        // Hide the "Add Tree" menu item for anyone who isn't admin/superadmin.
        $$('.menu li[data-page="add-tree"]').forEach(item => {
            item.classList.toggle('hidden', !canSubmitTrees());
        });
        // Example hook for a future superadmin-only "Manage Accounts" page.
        $$('.menu li[data-page="manage-accounts"]').forEach(item => {
            item.classList.toggle('hidden', !isSuperadmin());
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
            }
        } catch (error) {
            toast(`Database data could not be loaded: ${error.message}`);
        }

        await navigate('map');
    }

    await bootApp();
})();