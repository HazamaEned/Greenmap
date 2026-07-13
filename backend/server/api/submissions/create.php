<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';
require __DIR__ . '/../../sessions-helper.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['success' => false, 'message' => 'POST requests only.']);
    exit;
}

$user = requireRole(['admin', 'superadmin']);
$contentType = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
$isMultipart = str_starts_with(strtolower($contentType), 'multipart/form-data');
$data = $isMultipart ? $_POST : json_decode(file_get_contents('php://input'), true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON request body is required.']);
    exit;
}

// An existing species_id may be supplied. If it is omitted, the species
// fields are used to create (or reuse) a catalog entry in the transaction.
$speciesId = filter_var($data['species_id'] ?? null, FILTER_VALIDATE_INT);
$commonName = trim((string) ($data['common_name'] ?? ''));
$scientificName = trim((string) ($data['scientific_name'] ?? ''));
$originStatus = (string) ($data['origin_status'] ?? 'Unknown');
$description = trim((string) ($data['description'] ?? ''));

$treeStatus = (string) ($data['tree_status'] ?? 'Healthy');
$treeAge = array_key_exists('tree_age', $data) && $data['tree_age'] !== null && $data['tree_age'] !== ''
    ? filter_var($data['tree_age'], FILTER_VALIDATE_INT)
    : null;
$treePhoto = $isMultipart ? '' : trim((string) ($data['tree_photo'] ?? ''));
$latitude = filter_var($data['latitude'] ?? null, FILTER_VALIDATE_FLOAT);
$longitude = filter_var($data['longitude'] ?? null, FILTER_VALIDATE_FLOAT);

$photoUpload = $_FILES['tree_photo'] ?? null;
$hasPhotoUpload = is_array($photoUpload)
    && ($photoUpload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
$photoExtension = null;

if ($hasPhotoUpload) {
    if (($photoUpload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'The tree photo could not be uploaded.']);
        exit;
    }

    if (($photoUpload['size'] ?? 0) <= 0 || $photoUpload['size'] > 5 * 1024 * 1024) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'The tree photo must be no larger than 5 MB.']);
        exit;
    }

    $allowedPhotoTypes = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];
    $photoMime = (new finfo(FILEINFO_MIME_TYPE))->file($photoUpload['tmp_name']);
    $photoExtension = $allowedPhotoTypes[$photoMime] ?? null;

    if ($photoExtension === null) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Upload a JPG, PNG, or WebP tree photo.']);
        exit;
    }
}

$allowedOrigins = ['Native', 'Introduced', 'Unknown'];
$allowedStatuses = ['Healthy', 'Diseased', 'Dead', 'Removed'];
$usesExistingSpecies = $speciesId !== false && $speciesId !== null && $speciesId > 0;
$validNewSpecies = !$usesExistingSpecies
    && $commonName !== ''
    && mb_strlen($commonName) <= 80
    && $scientificName !== ''
    && mb_strlen($scientificName) <= 100
    && in_array($originStatus, $allowedOrigins, true)
    && mb_strlen($description) <= 5000;

if (
    (!$usesExistingSpecies && !$validNewSpecies) ||
    !in_array($treeStatus, $allowedStatuses, true) ||
    ($treeAge !== null && ($treeAge === false || $treeAge < 0 || $treeAge > 65535)) ||
    mb_strlen($treePhoto) > 255 ||
    $latitude === false || $latitude === null ||
    $longitude === false || $longitude === null ||
    $latitude < -90 || $latitude > 90 ||
    $longitude < -180 || $longitude > 180
) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Please check the contribution fields and try again.']);
    exit;
}

$description = $description !== '' ? $description : null;
$treePhoto = $treePhoto !== '' ? $treePhoto : null;
$submittedBy = $user['id'];
$uploadedPhotoPath = null;

try {
    $conn->begin_transaction();

    if ($usesExistingSpecies) {
        $speciesCheck = $conn->prepare(
            'SELECT species_id FROM species WHERE species_id = ? LIMIT 1'
        );
        $speciesCheck->bind_param('i', $speciesId);
        $speciesCheck->execute();

        if (!$speciesCheck->get_result()->fetch_assoc()) {
            $conn->rollback();
            http_response_code(422);
            echo json_encode(['success' => false, 'message' => 'The selected species no longer exists.']);
            exit;
        }
    } else {
        $speciesStatement = $conn->prepare(
            'INSERT INTO species (common_name, scientific_name, origin_status, description)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE species_id = LAST_INSERT_ID(species_id)'
        );
        $speciesStatement->bind_param(
            'ssss',
            $commonName,
            $scientificName,
            $originStatus,
            $description
        );
        $speciesStatement->execute();
        $speciesId = $conn->insert_id;
    }

    if ($hasPhotoUpload) {
        $uploadDirectory = dirname(__DIR__, 4) . '/uploads/trees';
        if (!is_dir($uploadDirectory) && !mkdir($uploadDirectory, 0775, true) && !is_dir($uploadDirectory)) {
            throw new RuntimeException('Unable to create the tree photo directory.');
        }

        $photoFileName = bin2hex(random_bytes(16)) . '.' . $photoExtension;
        $uploadedPhotoPath = $uploadDirectory . '/' . $photoFileName;
        if (!move_uploaded_file($photoUpload['tmp_name'], $uploadedPhotoPath)) {
            throw new RuntimeException('Unable to store the tree photo.');
        }
        $treePhoto = 'uploads/trees/' . $photoFileName;
    }

    $treeStatement = $conn->prepare(
        'INSERT INTO tree_data (species_id, tree_photo, tree_status, tree_age)
         VALUES (?, ?, ?, ?)'
    );
    $treeStatement->bind_param('issi', $speciesId, $treePhoto, $treeStatus, $treeAge);
    $treeStatement->execute();
    $treeId = $conn->insert_id;

    $isSuperadmin = $user['role'] === 'superadmin';
    $approvalStatus = $isSuperadmin ? 'Approved' : 'Pending';

    if ($isSuperadmin) {
        $submissionStatement = $conn->prepare(
            'INSERT INTO tree_submissions (
                tree_id, submitted_by, latitude, longitude,
                approval_status, reviewed_by, reviewed_at
             ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
        );
        $submissionStatement->bind_param(
            'iiddsi',
            $treeId,
            $submittedBy,
            $latitude,
            $longitude,
            $approvalStatus,
            $submittedBy
        );
    } else {
        $submissionStatement = $conn->prepare(
            'INSERT INTO tree_submissions (tree_id, submitted_by, latitude, longitude)
             VALUES (?, ?, ?, ?)'
        );
        $submissionStatement->bind_param('iidd', $treeId, $submittedBy, $latitude, $longitude);
    }
    $submissionStatement->execute();
    $submissionId = $conn->insert_id;

    $conn->commit();

    http_response_code(201);
    echo json_encode([
        'success' => true,
        'treeId' => (int) $treeId,
        'submissionId' => (int) $submissionId,
        'approvalStatus' => $approvalStatus,
        'message' => $isSuperadmin
            ? 'Tree contribution saved and approved.'
            : 'Tree contribution saved and marked as pending.',
    ]);
} catch (Throwable $exception) {
    $conn->rollback();
    if ($uploadedPhotoPath !== null && is_file($uploadedPhotoPath)) {
        unlink($uploadedPhotoPath);
    }
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to save the tree contribution.']);
}
