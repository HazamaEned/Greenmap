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

try {
    // Some deployments use `created_at` while others use `reported_at`.
    // Use COALESCE to support both column names and order by the resulting alias.
    $sql = '
    SELECT
        ir.issue_id,
        ir.issue_type,
        ir.details,
        COALESCE(ir.reported_at, ir.created_at) AS reported_at,
        u.id AS reporter_id,
        u.name AS reporter_name,
        u.email AS reporter_email
    FROM issue_reports ir
    INNER JOIN users u ON u.id = ir.reported_by
    ORDER BY reported_at DESC
';

$result = $conn->query($sql);
    $reports = [];

    while ($row = $result->fetch_assoc()) {
        $reports[] = [
            'issueId' => (int) $row['issue_id'],
            'issueType' => $row['issue_type'],
            'details' => $row['details'],
            'reportedAt' => $row['reported_at'],
            'reporter' => [
                'id' => (int) $row['reporter_id'],
                'name' => $row['reporter_name'],
                'email' => $row['reporter_email'],
            ],
        ];
    }

    echo json_encode(['success' => true, 'reports' => $reports]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load issue reports.']);
}