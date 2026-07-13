<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['success' => false, 'message' => 'POST requests only.']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON request body is required.']);
    exit;
}

$commonName = trim((string) ($data['name'] ?? ''));
$speciesName = trim((string) ($data['species'] ?? ''));
$originStatus = (string) ($data['status'] ?? 'Unknown');
$isActive = !empty($data['active']) ? 1 : 0;
$latitude = filter_var($data['lat'] ?? null, FILTER_VALIDATE_FLOAT);
$longitude = filter_var($data['lon'] ?? null, FILTER_VALIDATE_FLOAT);
$plantedMonth = (string) ($data['planted'] ?? '');
$allowedStatuses = ['Native', 'Introduced', 'Unknown'];

if (
    $commonName === '' ||
    $speciesName === '' ||
    strlen($commonName) > 80 ||
    strlen($speciesName) > 100 ||
    $latitude === false ||
    $longitude === false ||
    $latitude < -90 ||
    $latitude > 90 ||
    $longitude < -180 ||
    $longitude > 180 ||
    !in_array($originStatus, $allowedStatuses, true)
) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Invalid tree information.']);
    exit;
}

$plantedDate = null;
if ($plantedMonth !== '') {
    if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $plantedMonth)) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'The planted date must use YYYY-MM format.']);
        exit;
    }
    $plantedDate = $plantedMonth . '-01';
}

try {
    // Temporary owner until GreenMap has registration, login, and sessions.
    // Choosing it on the server prevents clients from claiming another user ID.
    $userResult = $conn->query(
        "SELECT user_id FROM users WHERE username = 'local_user' LIMIT 1"
    );
    $localUser = $userResult->fetch_assoc();

    if (!$localUser) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'The local development user is missing.']);
        exit;
    }

    $submittedBy = (int) $localUser['user_id'];

    $statement = $conn->prepare(
        'INSERT INTO trees (
            common_name, species_name, origin_status, is_active,
            latitude, longitude, planted_date, image_path, submitted_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    $imagePath = trim((string) ($data['img'] ?? 'trees/mango.jpg'));
    if ($imagePath === '' || strlen($imagePath) > 255) {
        $imagePath = 'trees/mango.jpg';
    }
    $statement->bind_param(
        'sssiddssi',
        $commonName,
        $speciesName,
        $originStatus,
        $isActive,
        $latitude,
        $longitude,
        $plantedDate,
        $imagePath,
        $submittedBy
    );
    $statement->execute();

    http_response_code(201);
    echo json_encode([
        'success' => true,
        'tree_id' => $conn->insert_id,
        'message' => 'Tree saved successfully.'
    ]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to save the tree.']);
}
