(() => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const config = window.GREENMAP_CONFIG || {};
    const pageExtension = config.pageExtension || 'html';
    const pageTitles = {
        dashboard: 'Dashboard',
        map: 'Map',
        'add-tree': 'Add Tree',
        contributions: 'My Contributions',
        settings: 'Settings'
    };

    const read = (key, fallback) => {
        try {
            return JSON.parse(localStorage.getItem(key)) ?? fallback;
        } catch {
            return fallback;
        }
    };

    const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

    // `status` is used by the map's Status filter. Set a sensible default for
    // existing samples - edit as needed.
    const samples = [
        {
            id: 1,
            name: 'Mango Tree',
            species: 'Mangifera indica',
            status: 'Native',
            lat: 14.5769,
            lon: 121.0848,
            planted: '2012',
            addedBy: 'UserA',
            img: 'trees/mango.jpg'
        },
        {
            id: 2,
            name: 'Samanea',
            species: 'Samanea saman',
            status: 'Introduced',
            lat: 14.5758,
            lon: 121.086,
            planted: '2015',
            addedBy: 'UserB',
            img: 'trees/samanea.jpg'
        },
        {
            id: 3,
            name: 'Narra',
            species: 'Pterocarpus indicus',
            status: 'Native',
            lat: 14.5771,
            lon: 121.0868,
            planted: '2008',
            addedBy: 'UserC',
            img: 'trees/narra.jpg'
        }
    ];

    let map;
    let treeLayer;
    let boundaryLayer;
    let userMarker;
    let startupLocationRequested = false;

    // Barangay boundary polygons, populated once Overpass data loads. Used to
    // work out which barangay a tree sits in, so "location" never needs to be
    // entered by hand.
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

    const trees = () => [...samples, ...read('greenmap.trees', [])];
    const profile = () => read('greenmap.profile', {
        name: 'User',
        email: '',
        phone: '',
        emailNotifications: true,
        trackingAlerts: false
    });

    function toast(message) {
        const element = $('#toast');
        element.textContent = message;
        element.classList.remove('hidden');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => element.classList.add('hidden'), 3000);
    }

    // --- Point-in-polygon barangay lookup -----------------------------------

    // Standard ray-casting point-in-polygon test. `ring` is an array of
    // [lat, lon] pairs. This is an approximation (OSM boundary relations can
    // have multiple ways per ring, which we concatenate in the order Overpass
    // returns them) but is accurate enough for "which barangay is this tree
    // roughly in".
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
        return barangayForPoint(tree.lat, tree.lon);
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
            write('greenmap.pendingLocation', {
                lat: event.latlng.lat,
                lon: event.latlng.lng
            });
            toast('Location selected. Open Add Tree to use it.');
        });
    }

    async function loadPasigBoundaries() {
        if (!boundaryLayer) return;

        const query = `
            [out:json][timeout:25];
            relation["name"~"^(Pasig|City of Pasig)$"]["boundary"="administrative"]["admin_level"="6"];
            map_to_area->.pasig;
            (
                relation["name"~"^(Pasig|City of Pasig)$"]["boundary"="administrative"]["admin_level"="6"];
                relation(area.pasig)["boundary"="administrative"]["admin_level"="10"];
            );
            out geom;
        `;

        try {
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: new URLSearchParams({ data: query })
            });

            if (!response.ok) throw new Error('Boundary request failed');

            const data = await response.json();
            const pasigBounds = L.latLngBounds([]);
            boundaryLayer.clearLayers();
            barangayPolygons = [];

            data.elements
                .filter(element => element.type === 'relation')
                .forEach(relation => drawBoundary(relation, pasigBounds));

            if (pasigBounds.isValid() && !userMarker) {
                map.fitBounds(pasigBounds, { padding: [35, 35] });
            }

            // Barangay polygons are ready now - refresh markers/popups/filter
            // options so trees pick up their computed location.
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
            const marker = L.marker([tree.lat, tree.lon], {
                icon: treeIcon(),
                title: tree.name
            })
                .addTo(treeLayer)
                .bindPopup(`
                    <strong>${escapeHtml(tree.name)}</strong><br>
                    ${escapeHtml(tree.species)}<br>
                    <small>${escapeHtml(tree.status || 'Unknown')} &middot; ${escapeHtml(location)}</small>
                `)
                .on('click', () => showTree(tree, location));

            treeMarkers.set(tree.id, { marker, tree, location });
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
                distance: distanceMeters(coordinates, [tree.lat, tree.lon])
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
                    .map(item => [item.tree.lat, item.tree.lon])
            ]);
            map.fitBounds(bounds, {
                padding: [70, 70],
                maxZoom: 17
            });
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
        $('#tree-img').src = tree.img || 'trees/mango.jpg';
        $('#tree-name').textContent = tree.name;
        $('#tree-species').textContent = `Species: ${tree.species}`;
        $('#tree-planted').textContent = `Planted: ${tree.planted}`;
        $('#tree-addedby').textContent = `Added by: ${tree.addedBy}`;

        const statusEl = $('#tree-status');
        if (statusEl) statusEl.textContent = `Status: ${tree.status || 'Unknown'}`;

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

        // Restore whatever the user had selected, if it's still a valid option.
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
            const haystack = `${tree.name} ${tree.species}`.toLowerCase();
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

    async function navigate(page) {
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
        if (page === 'add-tree') {
            addTree();
        }

        if (page === 'contributions') {
            contributions();
        }

        if (page === 'settings') {
            settings();
        }

        if (page === 'dashboard') {
            const allTrees = trees();
            const localTrees = read('greenmap.trees', []);
            $('#total-trees').textContent = allTrees.length;
            $('#my-trees').textContent = localTrees.length;
            $('#species-total').textContent = new Set(allTrees.map(tree => tree.species)).size;
        }
    }

    function addTree() {
        const form = $('#add-tree-form');
        const pendingLocation = read('greenmap.pendingLocation', null);

        if (pendingLocation) {
            form.latitude.value = pendingLocation.lat.toFixed(6);
            form.longitude.value = pendingLocation.lon.toFixed(6);
            localStorage.removeItem('greenmap.pendingLocation');
        }

        $('#use-location').onclick = () => locate(position => {
            form.latitude.value = position.coords.latitude.toFixed(6);
            form.longitude.value = position.coords.longitude.toFixed(6);
        });

        form.onsubmit = event => {
            event.preventDefault();
            if (!form.reportValidity()) return;

            const data = new FormData(form);
            const localTrees = read('greenmap.trees', []);
            localTrees.push({
                id: Date.now(),
                name: data.get('name').trim(),
                species: data.get('species').trim(),
                // Falls back to 'Native' if your add-tree form doesn't have a
                // status field yet - add <select name="status"> with
                // Native/Introduced options to let users set this.
                status: data.get('status') || 'Native',
                lat: Number(data.get('latitude')),
                lon: Number(data.get('longitude')),
                planted: data.get('planted'),
                active: data.get('active') === 'on',
                addedBy: profile().name || 'User',
                img: 'trees/mango.jpg'
            });

            write('greenmap.trees', localTrees);
            markers();
            populateMapFilters();
            applyMapFilters();
            toast('Tree saved on this device.');
            navigate('contributions');
        };
    }

    const escapeHtml = value => {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    };

    function contributions() {
        const localTrees = read('greenmap.trees', []);
        const body = $('#contributions-body');

        body.innerHTML = localTrees.length
            ? localTrees.map(tree => `
                <tr>
                    <td>${escapeHtml(tree.name)}</td>
                    <td>${escapeHtml(tree.planted)}</td>
                    <td>${tree.lat.toFixed(4)}, ${tree.lon.toFixed(4)}</td>
                    <td>
                        <button data-view="${tree.id}">View</button>
                        <button class="danger-link" data-remove="${tree.id}">Remove</button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="4" class="empty-state">No local contributions yet.</td></tr>';

        $$('[data-view]', body).forEach(button => {
            button.onclick = () => {
                const tree = localTrees.find(item => item.id == button.dataset.view);
                navigate('map').then(() => {
                    map.setView([tree.lat, tree.lon], 18);
                    showTree(tree, locationForTree(tree));
                });
            };
        });

        $$('[data-remove]', body).forEach(button => {
            button.onclick = () => {
                if (!confirm('Remove this locally saved tree?')) return;

                write('greenmap.trees', localTrees.filter(tree => tree.id != button.dataset.remove));
                markers();
                populateMapFilters();
                applyMapFilters();
                contributions();
                toast('Tree removed.');
            };
        });
    }

    function settings() {
        const savedProfile = profile();
        const form = $('#profile-form');

        form.name.value = savedProfile.name === 'User' ? '' : savedProfile.name;
        form.email.value = savedProfile.email;
        form.phone.value = savedProfile.phone;
        form.emailNotifications.checked = savedProfile.emailNotifications;
        form.trackingAlerts.checked = savedProfile.trackingAlerts;

        form.onsubmit = event => {
            event.preventDefault();
            if (!form.reportValidity()) return;

            const data = new FormData(form);
            write('greenmap.profile', {
                name: data.get('name').trim(),
                email: data.get('email').trim(),
                phone: data.get('phone').trim(),
                emailNotifications: data.has('emailNotifications'),
                trackingAlerts: data.has('trackingAlerts')
            });

            welcome();
            toast('Settings saved on this device.');
        };

        $$('.requires-database').forEach(button => {
            button.onclick = () => toast('Available after database and authentication setup.');
        });
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
            {
                enableHighAccuracy: true,
                timeout: 10000
            }
        );
    }

    function welcome() {
        $('#welcome-user').textContent = `Welcome, ${profile().name || 'User'}`;
    }

    $$('.menu li').forEach(item => {
        item.onclick = () => navigate(item.dataset.page);
    });

    $('.menu-toggle').onclick = () => $('.menu').classList.toggle('open');
    $('#close-tree-popup').onclick = () => $('.tree-popup').classList.add('hidden');
    $('#gps-button').onclick = () => locate();

    const dialog = $('#issue-dialog');
    $('.issue-btn').onclick = () => dialog.showModal();
    $('#cancel-issue').onclick = () => dialog.close();
    $('#issue-form').onsubmit = event => {
        event.preventDefault();
        const issues = read('greenmap.issues', []);
        issues.push({
            type: $('#issue-type').value,
            details: $('#issue-details').value.trim(),
            created: new Date().toISOString()
        });

        write('greenmap.issues', issues);
        event.target.reset();
        dialog.close();
        toast('Issue saved on this device.');
    };

    welcome();
    initMap();
})();