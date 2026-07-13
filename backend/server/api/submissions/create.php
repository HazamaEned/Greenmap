<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';
require __DIR__ . '/../../session_helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['success' => false, 'message' => 'POST requests only.']);
    exit;
}

// Only admin and superadmin accounts may submit trees. This also confirms
// the request is authenticated before we touch the database at all.
$user = requireRole(['admin', 'superadmin']);

$data = json_decode(file_get_contents('php://input'), true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON request body is required.']);
    exit;
}

// --- tree_data fields ---
$speciesId = filter_var($data['species_id'] ?? null, FILTER_VALIDATE_INT);
$treeStatus = (string) ($data['tree_status'] ?? 'Healthy');
$treeAge = array_key_exists('tree_age', $data) && $data['tree_age'] !== null
    ? filter_var($data['tree_age'], FILTER_VALIDATE_INT)
    : null;
$treePhoto = trim((string) ($data['tree_photo'] ?? ''));

// --- tree_submissions fields ---
$latitude = filter_var($data['latitude'] ?? null, FILTER_VALIDATE_FLOAT);
$longitude = filter_var($data['longitude'] ?? null, FILTER_VALIDATE_FLOAT);

$allowedStatuses = ['Healthy', 'Diseased', 'Dead', 'Removed'];

if (
    $speciesId === false || $speciesId === null || $speciesId <= 0 ||
    !in_array($treeStatus, $allowedStatuses, true) ||
    ($treeAge !== null && ($treeAge === false || $treeAge < 0 || $treeAge > 32767)) ||
    strlen($treePhoto) > 255 ||
    $latitude === false || $latitude === null ||
    $longitude === false || $longitude === null ||
    $latitude < -90 || $latitude > 90 ||
    $longitude < -180 || $longitude > 180
) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Invalid tree submission information.']);
    exit;
}

$treePhoto = $treePhoto !== '' ? $treePhoto : null;
$submittedBy = $user['id'];

try {
    // Confirm the species actually exists before we insert against it.
    // Without this, a bad species_id surfaces as a generic FK failure
    // instead of a clear validation message.
    $speciesCheck = $conn->prepare(
        'SELECT species_id FROM species WHERE species_id = ? LIMIT 1'
    );
    $speciesCheck->bind_param('i', $speciesId);
    $speciesCheck->execute();
    $speciesRow = $speciesCheck->get_result()->fetch_assoc();

    if (!$speciesRow) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'The selected species does not exist.']);
        exit;
    }

    // Both inserts must succeed together, or neither should persist.
    // Otherwise a failed submission insert would leave an orphaned tree_data row.
    $conn->begin_transaction();

    $treeStatement = $conn->prepare(
        'INSERT INTO tree_data (species_id, tree_photo, tree_status, tree_age)
        VALUES (?, ?, ?, ?)'
    );
    $treeStatement->bind_param(
        'issi', $speciesId, $treePhoto, $treeStatus, $treeAge
    );
    $treeStatement->execute();
    $treeId = $conn->insert_id;

    $submissionStatement = $conn->prepare(
        'INSERT INTO tree_submissions (
            tree_id, submitted_by, latitude, longitude, approval_status
        ) VALUES (?, ?, ?, ?, ?)'
    );
    $approvalStatus = 'Pending';
    $submissionStatement->bind_param(
        'iidds', $treeId, $submittedBy, $latitude, $longitude, $approvalStatus
    );
    $submissionStatement->execute();
    $submissionId = $conn->insert_id;

    $conn->commit();

    http_response_code(201);
    echo json_encode([
        'success' => true,
        'tree_id' => $treeId,
        'submission_id' => $submissionId,
        'message' => 'Tree submission received and is pending review.'
    ]);
} catch (mysqli_sql_exception $exception) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to save the tree submission.']);
}