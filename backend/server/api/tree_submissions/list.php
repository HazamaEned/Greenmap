<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';
require __DIR__ . '/../../sessions-helper.php';
sendCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['success' => false, 'message' => 'GET requests only.']);
    exit;
}

// Optional viewport filter, so the frontend can request only the pins
// visible on screen instead of every tree in the city at once.
$minLat = filter_var($_GET['min_lat'] ?? null, FILTER_VALIDATE_FLOAT);
$maxLat = filter_var($_GET['max_lat'] ?? null, FILTER_VALIDATE_FLOAT);
$minLon = filter_var($_GET['min_lon'] ?? null, FILTER_VALIDATE_FLOAT);
$maxLon = filter_var($_GET['max_lon'] ?? null, FILTER_VALIDATE_FLOAT);
$hasBounds = $minLat !== false && $minLat !== null
    && $maxLat !== false && $maxLat !== null
    && $minLon !== false && $minLon !== null
    && $maxLon !== false && $maxLon !== null;

// Optional species filter, e.g. for a "show only Narra trees" toggle.
$speciesId = isset($_GET['species_id'])
    ? filter_var($_GET['species_id'], FILTER_VALIDATE_INT)
    : null;

try {
    $sql = "SELECT
            td.tree_id,
            td.tree_photo,
            td.tree_status,
            td.tree_age,
            sp.species_id,
            sp.common_name,
            sp.scientific_name,
            sp.origin_status,
            ts.latitude,
            ts.longitude,
            ts.submitted_at
        FROM tree_data td
        INNER JOIN species sp ON sp.species_id = td.species_id
        INNER JOIN (
            SELECT tree_id, MAX(submission_id) AS latest_submission_id
            FROM tree_submissions
            WHERE approval_status = 'Approved'
            GROUP BY tree_id
        ) AS latest ON latest.tree_id = td.tree_id
        INNER JOIN tree_submissions ts ON ts.submission_id = latest.latest_submission_id
        WHERE td.tree_status != 'Removed'";

    $types = '';
    $params = [];

    if ($hasBounds) {
        $sql .= ' AND ts.latitude BETWEEN ? AND ? AND ts.longitude BETWEEN ? AND ?';
        $types .= 'dddd';
        $params[] = $minLat;
        $params[] = $maxLat;
        $params[] = $minLon;
        $params[] = $maxLon;
    }

    if ($speciesId !== null && $speciesId !== false && $speciesId > 0) {
        $sql .= ' AND sp.species_id = ?';
        $types .= 'i';
        $params[] = $speciesId;
    }

    $statement = $conn->prepare($sql);
    if ($types !== '') {
        $statement->bind_param($types, ...$params);
    }
    $statement->execute();
    $result = $statement->get_result();

    $trees = [];
    while ($row = $result->fetch_assoc()) {
        $trees[] = [
            'treeId' => (int) $row['tree_id'],
            'photo' => $row['tree_photo'],
            'status' => $row['tree_status'],
            'age' => $row['tree_age'] !== null ? (int) $row['tree_age'] : null,
            'species' => [
                'speciesId' => (int) $row['species_id'],
                'commonName' => $row['common_name'],
                'scientificName' => $row['scientific_name'],
                'originStatus' => $row['origin_status']
            ],
            'latitude' => (float) $row['latitude'],
            'longitude' => (float) $row['longitude']
        ];
    }

    echo json_encode([
        'success' => true,
        'count' => count($trees),
        'trees' => $trees
    ]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load tree pins.']);
}