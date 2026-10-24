<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';
require __DIR__ . '/../../sessions-helper.php';
sendCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['success' => false, 'message' => 'POST requests only.']);
    exit;
}

// Anyone may submit a tree action report. If the user is logged in, the
// submission is attributed to their account; otherwise it is anonymous.
$user = getCurrentUserIfLoggedIn(); // helper defined in sessions-helper.php

$contentType = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
$isMultipart = str_starts_with(strtolower($contentType), 'multipart/form-data');
$data = $isMultipart ? $_POST : json_decode(file_get_contents('php://input'), true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid request body is required.']);
    exit;
}

// ── New action fields ────────────────────────────────────────────────────
$actionType = trim((string) ($data['action_type'] ?? ''));
$priority   = trim((string) ($data['priority']   ?? 'Moderate'));
$reason     = trim((string) ($data['reason']     ?? ''));
$address    = trim((string) ($data['address']    ?? ''));
$areaType   = trim((string) ($data['area_type']   ?? 'Public'));
if (!in_array($areaType, ['Public', 'Private'], true)) {
    $areaType = 'Public';
}

// ── Reporter contact (optional, public form) ─────────────────────────────
$reporterName    = trim((string) ($data['reporter_name']    ?? ''));
$reporterContact = trim((string) ($data['reporter_contact'] ?? ''));

// ── Species fields (optional) ────────────────────────────────────────────
$speciesId      = filter_var($data['species_id'] ?? null, FILTER_VALIDATE_INT);
$commonName     = trim((string) ($data['common_name']     ?? ''));
$scientificName = trim((string) ($data['scientific_name'] ?? ''));
$originStatus   = (string) ($data['origin_status'] ?? 'Unknown');
$description    = trim((string) ($data['description']    ?? ''));

// ── Tree condition fields (optional) ─────────────────────────────────────
$treeStatus = (string) ($data['tree_status'] ?? 'Healthy');
$treeAge    = array_key_exists('tree_age', $data) && $data['tree_age'] !== null && $data['tree_age'] !== ''
    ? filter_var($data['tree_age'], FILTER_VALIDATE_INT)
    : null;
$treePhoto  = $isMultipart ? '' : trim((string) ($data['tree_photo'] ?? ''));
$latitude   = filter_var($data['latitude']  ?? null, FILTER_VALIDATE_FLOAT);
$longitude  = filter_var($data['longitude'] ?? null, FILTER_VALIDATE_FLOAT);

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
        'image/jpeg'  => 'jpg',
        'image/pjpeg' => 'jpg',
        'image/jpg'   => 'jpg',
        'image/png'   => 'png',
        'image/x-png' => 'png',
        'image/webp'  => 'webp',
    ];
    $photoMime = null;
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $detected = $finfo->file($photoUpload['tmp_name']);
        if (is_string($detected)) {
            $photoMime = strtolower($detected);
        }
    } elseif (function_exists('mime_content_type')) {
        $detected = mime_content_type($photoUpload['tmp_name']);
        if (is_string($detected)) {
            $photoMime = strtolower($detected);
        }
    }
    if (!$photoMime && !empty($photoUpload['type'])) {
        $photoMime = strtolower((string) $photoUpload['type']);
    }

    $photoExtension = $allowedPhotoTypes[$photoMime] ?? null;

    if ($photoExtension === null && function_exists('exif_imagetype')) {
        $imageType = @exif_imagetype($photoUpload['tmp_name']);
        if ($imageType === IMAGETYPE_JPEG) {
            $photoExtension = 'jpg';
        } elseif ($imageType === IMAGETYPE_PNG) {
            $photoExtension = 'png';
        } elseif ($imageType === IMAGETYPE_WEBP) {
            $photoExtension = 'webp';
        }
    }

    if ($photoExtension === null) {
        $originalExt = strtolower(pathinfo($photoUpload['name'] ?? '', PATHINFO_EXTENSION));
        if (in_array($originalExt, ['jpg', 'jpeg'], true)) {
            $photoExtension = 'jpg';
        } elseif ($originalExt === 'png') {
            $photoExtension = 'png';
        } elseif ($originalExt === 'webp') {
            $photoExtension = 'webp';
        }
    }

    if ($photoExtension === null) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Upload a JPG, PNG, or WebP tree photo.']);
        exit;
    }
}

$isAdminOrSuperadmin = $user !== null && in_array($user['role'] ?? '', ['admin', 'superadmin'], true);

// Guests are only permitted to request trimming or removal; moving/relocating requires admin authority
if ($actionType === 'Move' && !$isAdminOrSuperadmin) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'message' => 'Moving or relocating a tree can only be requested by administrators.'
    ]);
    exit;
}

$allowedActionTypes = $isAdminOrSuperadmin ? ['Trim', 'Move', 'Remove'] : ['Trim', 'Remove'];
$allowedPriorities  = ['Urgent', 'High', 'Moderate', 'Low'];
$allowedOrigins     = ['Native', 'Introduced', 'Unknown'];
$allowedStatuses    = ['Healthy', 'Diseased', 'Dead', 'Removed'];

$usesExistingSpecies = $speciesId !== false && $speciesId !== null && $speciesId > 0;
$hasNoSpecies        = !$usesExistingSpecies && $commonName === '' && $scientificName === '';
$validNewSpecies     = !$usesExistingSpecies && !$hasNoSpecies
    && $commonName !== ''
    && mb_strlen($commonName)     <= 80
    && $scientificName !== ''
    && mb_strlen($scientificName) <= 100
    && in_array($originStatus, $allowedOrigins, true)
    && mb_strlen($description)    <= 5000;

if (
    !in_array($actionType, $allowedActionTypes, true) ||
    !in_array($priority,   $allowedPriorities,  true) ||
    mb_strlen($reason)  > 1000 ||
    mb_strlen($address) > 255  ||
    (!$usesExistingSpecies && !$hasNoSpecies && !$validNewSpecies) ||
    !in_array($treeStatus, $allowedStatuses, true) ||
    ($treeAge !== null && ($treeAge === false || $treeAge < 0 || $treeAge > 65535)) ||
    mb_strlen($treePhoto) > 255 ||
    $latitude  === false || $latitude  === null ||
    $longitude === false || $longitude === null ||
    $latitude  < -90 || $latitude  > 90 ||
    $longitude < -180 || $longitude > 180
) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Please check the report fields and try again.']);
    exit;
}

if (!isLocationInsidePasig((float) $latitude, (float) $longitude)) {
    http_response_code(422);
    echo json_encode([
        'success' => false,
        'message' => 'Out of bounds, try again. Tree location must be inside Pasig City border.'
    ]);
    exit;
}

$description = $description !== '' ? $description : null;
$reason      = $reason  !== '' ? $reason  : null;
$address     = $address !== '' ? $address : null;
$reporterName    = $reporterName    !== '' ? $reporterName    : null;
$reporterContact = $reporterContact !== '' ? $reporterContact : null;
$treePhoto   = $treePhoto !== '' ? $treePhoto : null;

// Submitted-by may be null for anonymous public reports
$submittedBy      = $user['id'] ?? null;
$uploadedPhotoPath = null;

try {
    $conn->begin_transaction();

    if ($hasNoSpecies) {
        // No species provided — use a generic placeholder row
        $speciesStatement = $conn->prepare(
            'INSERT INTO species (common_name, scientific_name, origin_status, description)
             VALUES (\'Unknown\', \'Unknown\', \'Unknown\', NULL)
             ON DUPLICATE KEY UPDATE species_id = LAST_INSERT_ID(species_id)'
        );
        $speciesStatement->execute();
        $speciesId = $conn->insert_id;
    } elseif ($usesExistingSpecies) {
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

        $photoFileName    = bin2hex(random_bytes(16)) . '.' . $photoExtension;
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

    $isSuperadmin   = ($user['role'] ?? '') === 'superadmin';
    $approvalStatus = $isSuperadmin ? 'Approved' : 'Pending';

    // Check if the area_type column exists in tree_submissions
    $hasAreaType = false;
    $colCheck = $conn->query("SHOW COLUMNS FROM `tree_submissions` LIKE 'area_type'");
    if ($colCheck && $colCheck->num_rows > 0) {
        $hasAreaType = true;
    }

    if ($isSuperadmin) {
        if ($hasAreaType) {
            $submissionStatement = $conn->prepare(
                'INSERT INTO tree_submissions (
                    tree_id, submitted_by, latitude, longitude,
                    action_type, priority, reason, address, area_type,
                    reporter_name, reporter_contact,
                    approval_status, reviewed_by, reviewed_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
            );
            $submissionStatement->bind_param(
                'iiddsssssssssi',
                $treeId,
                $submittedBy,
                $latitude,
                $longitude,
                $actionType,
                $priority,
                $reason,
                $address,
                $areaType,
                $reporterName,
                $reporterContact,
                $approvalStatus,
                $submittedBy
            );
        } else {
            $submissionStatement = $conn->prepare(
                'INSERT INTO tree_submissions (
                    tree_id, submitted_by, latitude, longitude,
                    action_type, priority, reason, address,
                    reporter_name, reporter_contact,
                    approval_status, reviewed_by, reviewed_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
            );
            $submissionStatement->bind_param(
                'iiddsssssssi',
                $treeId,
                $submittedBy,
                $latitude,
                $longitude,
                $actionType,
                $priority,
                $reason,
                $address,
                $reporterName,
                $reporterContact,
                $approvalStatus,
                $submittedBy
            );
        }
    } else {
        if ($hasAreaType) {
            $submissionStatement = $conn->prepare(
                'INSERT INTO tree_submissions
                    (tree_id, submitted_by, latitude, longitude, action_type, priority, reason, address, area_type, reporter_name, reporter_contact)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $submissionStatement->bind_param(
                'iiddsssssss',
                $treeId,
                $submittedBy,
                $latitude,
                $longitude,
                $actionType,
                $priority,
                $reason,
                $address,
                $areaType,
                $reporterName,
                $reporterContact
            );
        } else {
            $submissionStatement = $conn->prepare(
                'INSERT INTO tree_submissions
                    (tree_id, submitted_by, latitude, longitude, action_type, priority, reason, address, reporter_name, reporter_contact)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $submissionStatement->bind_param(
                'iiddssssss',
                $treeId,
                $submittedBy,
                $latitude,
                $longitude,
                $actionType,
                $priority,
                $reason,
                $address,
                $reporterName,
                $reporterContact
            );
        }
    }
    $submissionStatement->execute();
    $submissionId = $conn->insert_id;

    $conn->commit();

    http_response_code(201);
    echo json_encode([
        'success'        => true,
        'treeId'         => (int) $treeId,
        'submissionId'   => (int) $submissionId,
        'approvalStatus' => $approvalStatus,
        'message'        => $isSuperadmin
            ? 'Tree action report saved and approved.'
            : 'Tree action report submitted and pending review.',
    ]);
} catch (Throwable $exception) {
    $conn->rollback();
    if ($uploadedPhotoPath !== null && is_file($uploadedPhotoPath)) {
        unlink($uploadedPhotoPath);
    }
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to save the tree action report: ' . $exception->getMessage()]);
}


/**
 * Validates that the given coordinates fall within the Pasig City boundary polygons.
 */
function isLocationInsidePasig(float $latitude, float $longitude): bool {
    static $boundaryFeatures = null;

    if ($boundaryFeatures === null) {
        $cacheFile = dirname(__DIR__, 2) . '/cache/pasig-boundaries-v2.json';
        if (!is_file($cacheFile)) {
            $legacy = dirname(__DIR__, 2) . '/cache/pasig-boundaries.json';
            $cacheFile = is_file($legacy) ? $legacy : null;
        }

        if ($cacheFile !== null) {
            $raw = file_get_contents($cacheFile);
            $data = is_string($raw) ? json_decode($raw, true) : null;
            $boundaryFeatures = $data['barangays']['features'] ?? [];
        } else {
            $boundaryFeatures = [];
        }
    }

    if (empty($boundaryFeatures)) {
        return true;
    }

    foreach ($boundaryFeatures as $feature) {
        $geometry = $feature['geometry'] ?? null;
        if (!$geometry) {
            continue;
        }

        if (($geometry['type'] ?? '') === 'Polygon') {
            if (pointInPolygonGeo($latitude, $longitude, $geometry['coordinates'] ?? [])) {
                return true;
            }
        } elseif (($geometry['type'] ?? '') === 'MultiPolygon') {
            foreach ($geometry['coordinates'] ?? [] as $polygon) {
                if (pointInPolygonGeo($latitude, $longitude, $polygon)) {
                    return true;
                }
            }
        }
    }

    return false;
}

function pointInRingGeo(float $lat, float $lon, array $ring): bool {
    $inside = false;
    $count = count($ring);
    for ($i = 0, $j = $count - 1; $i < $count; $j = $i++) {
        $lonI = (float) $ring[$i][0];
        $latI = (float) $ring[$i][1];
        $lonJ = (float) $ring[$j][0];
        $latJ = (float) $ring[$j][1];
        $intersects = (($lonI > $lon) !== ($lonJ > $lon))
            && ($lat < ($latJ - latI) * ($lon - lonI) / ($lonJ - $lonI) + $latI);
        if ($intersects) {
            $inside = !$inside;
        }
    }
    return $inside;
}

function pointInPolygonGeo(float $lat, float $lon, array $rings): bool {
    if (empty($rings) || !pointInRingGeo($lat, $lon, $rings[0])) {
        return false;
    }
    for ($k = 1, $numRings = count($rings); $k < $numRings; $k++) {
        if (pointInRingGeo($lat, $lon, $rings[$k])) {
            return false;
        }
    }
    return true;
}
