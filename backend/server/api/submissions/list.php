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

$user = requireRole(['admin', 'superadmin']);

try {
    $statement = $conn->prepare(
        'SELECT
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
            species.description,
            submitter.name AS added_by,
            reviewer.name AS reviewed_by_name
         FROM tree_submissions
         INNER JOIN tree_data
            ON tree_data.tree_id = tree_submissions.tree_id
         INNER JOIN species
            ON species.species_id = tree_data.species_id
         INNER JOIN users AS submitter
            ON submitter.id = tree_submissions.submitted_by
         LEFT JOIN users AS reviewer
            ON reviewer.id = tree_submissions.reviewed_by
         WHERE tree_submissions.submitted_by = ?
         ORDER BY tree_submissions.submitted_at DESC, tree_submissions.submission_id DESC'
    );
    $userId = $user['id'];
    $statement->bind_param('i', $userId);
    $statement->execute();
    $result = $statement->get_result();

    $contributions = [];
    while ($row = $result->fetch_assoc()) {
        $contributions[] = [
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
                'description' => $row['description'],
            ],
            'latitude' => (float) $row['latitude'],
            'longitude' => (float) $row['longitude'],
            'approvalStatus' => $row['approval_status'],
            'addedBy' => $row['added_by'],
            'submittedAt' => $row['submitted_at'],
            'reviewedAt' => $row['reviewed_at'],
            'reviewedBy' => $row['reviewed_by_name'],
        ];
    }

    echo json_encode([
        'success' => true,
        'count' => count($contributions),
        'contributions' => $contributions,
    ]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load your contributions.']);
}
