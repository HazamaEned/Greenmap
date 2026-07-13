<?php

header('Content-Type: application/json; charset=utf-8');

$cacheDirectory = __DIR__ . '/../cache';
$cacheFile = $cacheDirectory . '/pasig-boundaries.json';
$cacheLifetime = 7 * 24 * 60 * 60;

if (is_file($cacheFile) && time() - filemtime($cacheFile) < $cacheLifetime) {
    readfile($cacheFile);
    exit;
}

$query = <<<'OVERPASS'
[out:json][timeout:25];
relation["name"~"^(Pasig|City of Pasig)$"]["boundary"="administrative"]["admin_level"="6"];
map_to_area->.pasig;
(
    relation["name"~"^(Pasig|City of Pasig)$"]["boundary"="administrative"]["admin_level"="6"];
    relation(area.pasig)["boundary"="administrative"]["admin_level"="10"];
);
out geom;
OVERPASS;

$endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.nchc.org.tw/api/interpreter'
];

foreach ($endpoints as $endpoint) {
    $curl = curl_init($endpoint);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query(['data' => $query]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 35,
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_USERAGENT => 'GreenMap/1.0 local development'
    ]);

    $body = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);

    if ($status !== 200 || !is_string($body)) continue;

    $data = json_decode($body, true);
    $relations = array_filter(
        $data['elements'] ?? [],
        static fn(array $element): bool => ($element['type'] ?? '') === 'relation'
    );

    if (!$relations) continue;

    if (!is_dir($cacheDirectory)) {
        mkdir($cacheDirectory, 0775, true);
    }
    file_put_contents($cacheFile, $body, LOCK_EX);
    echo $body;
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
