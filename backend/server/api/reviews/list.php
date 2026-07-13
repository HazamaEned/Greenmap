<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';
require __DIR__ . '/../../sessions-helper.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['success' => false, 'message' => 'GET requests only.']);
    exit;
}

requireRole(['superadmin']);

$status = trim((string) ($_GET['status'] ?? ''));
$allowedStatuses = ['', 'Pending', 'Approved', 'Rejected'];
if (!in_array($status, $allowedStatuses, true)) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Invalid approval status filter.']);
    exit;
}

try {
    $sql = 'SELECT
                tree_submissions.submission_id,
                tree_submissions.tree_id,
                tree_submissions.latitude,
                tree_submissions.longitude,
                tree_submissions.approval_status,
                tree_submissions.submitted_at,
                tree_submissions.reviewed_at,
                tree_data.tree_photo,
                tree_data.tree_status,
                tree_data.tree_age,
                species.species_id,
                species.common_name,
                species.scientific_name,
                species.origin_status,
                submitter.id AS submitted_by_id,
                submitter.name AS submitted_by_name,
                submitter.email AS submitted_by_email,
                reviewer.name AS reviewed_by_name
            FROM tree_submissions
            INNER JOIN tree_data ON tree_data.tree_id = tree_submissions.tree_id
            INNER JOIN species ON species.species_id = tree_data.species_id
            INNER JOIN users AS submitter ON submitter.id = tree_submissions.submitted_by
            LEFT JOIN users AS reviewer ON reviewer.id = tree_submissions.reviewed_by';

    if ($status !== '') {
        $sql .= ' WHERE tree_submissions.approval_status = ?';
    }
    $sql .= ' ORDER BY tree_submissions.submitted_at DESC, tree_submissions.submission_id DESC';

    $statement = $conn->prepare($sql);
    if ($status !== '') {
        $statement->bind_param('s', $status);
    }
    $statement->execute();
    $result = $statement->get_result();

    $submissions = [];
    while ($row = $result->fetch_assoc()) {
        $submissions[] = [
            'submissionId' => (int) $row['submission_id'],
            'treeId' => (int) $row['tree_id'],
            'photo' => $row['tree_photo'],
            'status' => $row['tree_status'],
            'age' => $row['tree_age'] !== null ? (int) $row['tree_age'] : null,
            'species' => [
                'speciesId' => (int) $row['species_id'],
                'commonName' => $row['common_name'],
                'scientificName' => $row['scientific_name'],
                'originStatus' => $row['origin_status'],
            ],
            'latitude' => (float) $row['latitude'],
            'longitude' => (float) $row['longitude'],
            'approvalStatus' => $row['approval_status'],
            'submittedAt' => $row['submitted_at'],
            'reviewedAt' => $row['reviewed_at'],
            'reviewedBy' => $row['reviewed_by_name'],
            'submittedBy' => [
                'id' => (int) $row['submitted_by_id'],
                'name' => $row['submitted_by_name'],
                'email' => $row['submitted_by_email'],
            ],
        ];
    }

    echo json_encode([
        'success' => true,
        'count' => count($submissions),
        'submissions' => $submissions,
    ]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load contribution reviews.']);
}
