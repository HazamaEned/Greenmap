<?php

header('Content-Type: application/json; charset=utf-8');

$cacheDirectory = dirname(__DIR__) . '/cache';
$cacheFile = $cacheDirectory . '/pasig-boundaries-v2.json';
$legacyCacheFile = $cacheDirectory . '/pasig-boundaries.json';
$cacheLifetime = 7 * 24 * 60 * 60;

if (is_file($cacheFile) && time() - filemtime($cacheFile) < $cacheLifetime) {
    readfile($cacheFile);
    exit;
}

$barangayQuery = http_build_query([
    'where' => "city_code='137403000'",
    'outFields' => 'brgy_name,brgy_code,psgc_10d',
    'returnGeometry' => 'true',
    'outSR' => '4326',
    'f' => 'geojson',
]);
$barangayUrl = 'https://ulap-nga.georisk.gov.ph/arcgis/rest/services/PSA/BarangayPopMF/MapServer/0/query?'
    . $barangayQuery;

$curl = curl_init($barangayUrl);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 35,
    CURLOPT_USERAGENT => 'GreenMap/1.0 local development',
]);
$barangayBody = curl_exec($curl);
$barangayStatus = curl_getinfo($curl, CURLINFO_HTTP_CODE);
curl_close($curl);

$barangayData = is_string($barangayBody) ? json_decode($barangayBody, true) : null;
$features = $barangayData['features'] ?? [];

$canonicalNames = [
    'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan', 'Dela Paz',
    'Kalawaan', 'Kapasigan', 'Kapitolyo', 'Malinao', 'Manggahan', 'Maybunga',
    'Oranbo', 'Palatiw', 'Pinagbuhatan', 'Pineda', 'Rosario', 'Sagad', 'San Antonio',
    'San Joaquin', 'San Jose', 'San Miguel', 'San Nicolas', 'Santa Cruz', 'Santa Lucia',
    'Santa Rosa', 'Santo Tomas', 'Santolan', 'Sumilang', 'Ugong',
];

foreach ($features as &$feature) {
    $name = $feature['properties']['brgy_name'] ?? '';
    if ($name === 'San Nicolas (Pob.)') $name = 'San Nicolas';
    $feature['properties']['name'] = $name;
}
unset($feature);

$receivedNames = array_column(array_column($features, 'properties'), 'name');
sort($receivedNames);
$expectedNames = $canonicalNames;
sort($expectedNames);
$hasCompleteBarangayData = $barangayStatus === 200
    && count($features) === count($canonicalNames)
    && $receivedNames === $expectedNames;

// Preserve the existing Pasig city outline without making barangay refreshes
// depend on a second external service. The authoritative barangay polygons are
// fetched independently from the government GeoRisk service above.
$cityBoundary = null;
if (is_file($legacyCacheFile)) {
    $legacyData = json_decode(file_get_contents($legacyCacheFile), true);
    $relations = array_values(array_filter(
        $legacyData['elements'] ?? [],
        static fn(array $element): bool => ($element['type'] ?? '') === 'relation'
            && ($element['tags']['admin_level'] ?? '') === '6'
    ));
    $cityBoundary = $relations[0] ?? null;
}

if ($hasCompleteBarangayData) {
    $response = json_encode([
        'success' => true,
        'barangays' => [
            'type' => 'FeatureCollection',
            'features' => $features,
        ],
        'cityBoundary' => $cityBoundary,
    ], JSON_UNESCAPED_SLASHES);

    if (!is_dir($cacheDirectory)) {
        mkdir($cacheDirectory, 0775, true);
    }
    file_put_contents($cacheFile, $response, LOCK_EX);
    echo $response;
    exit;
}

// An expired cache is still more useful than making all borders disappear.
if (is_file($cacheFile)) {
    header('Warning: 110 - "Serving stale boundary data"');
    readfile($cacheFile);
    exit;
}

http_response_code(503);
echo json_encode([
    'success' => false,
    'message' => 'Boundary data is temporarily unavailable.'
]);
