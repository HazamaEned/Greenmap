<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';

try {
    $sql = '
        SELECT
            tree_data.tree_id,
            tree_data.tree_photo,
            tree_data.tree_status,
            tree_data.tree_age,
            species.species_id,
            species.common_name,
            species.scientific_name,
            species.origin_status,
            tree_submissions.latitude,
            tree_submissions.longitude,
            tree_submissions.submitted_at,
            users.name AS added_by
        FROM tree_data
        INNER JOIN species
            ON species.species_id = tree_data.species_id
        INNER JOIN tree_submissions
            ON tree_submissions.submission_id = (
                SELECT MAX(latest_submission.submission_id)
                FROM tree_submissions AS latest_submission
                WHERE latest_submission.tree_id = tree_data.tree_id
                  AND latest_submission.approval_status = \'Approved\'
            )
        INNER JOIN users
            ON users.id = tree_submissions.submitted_by
        WHERE tree_data.tree_status <> \'Removed\'
        ORDER BY tree_submissions.submitted_at DESC
    ';

    $result = $conn->query($sql);
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
                'originStatus' => $row['origin_status'],
            ],
            'latitude' => (float) $row['latitude'],
            'longitude' => (float) $row['longitude'],
            'submittedAt' => $row['submitted_at'],
            'addedBy' => $row['added_by'],
        ];
    }

    echo json_encode([
        'success' => true,
        'count' => count($trees),
        'trees' => $trees,
    ]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);

    echo json_encode([
        'success' => false,
        'message' => 'Unable to load trees.',
    ]);
}
