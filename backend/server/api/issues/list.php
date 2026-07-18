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
    // Determine which timestamp column exists to avoid referencing missing columns.
    $timestampCol = null;
    $colRes = $conn->query("SHOW COLUMNS FROM issue_reports LIKE 'reported_at'");
    if ($colRes && $colRes->num_rows) {
        $timestampCol = 'reported_at';
    } else {
        $colRes = $conn->query("SHOW COLUMNS FROM issue_reports LIKE 'created_at'");
        if ($colRes && $colRes->num_rows) {
            $timestampCol = 'created_at';
        }
    }

    if ($timestampCol) {
        $sql = sprintf("SELECT ir.issue_id, ir.issue_type, ir.details, ir.%s AS reported_at, u.id AS reporter_id, u.name AS reporter_name, u.email AS reporter_email FROM issue_reports ir LEFT JOIN users u ON u.id = ir.reported_by ORDER BY reported_at DESC", $timestampCol);
    } else {
        // No timestamp column found; return rows with NULL reported_at
        $sql = "SELECT ir.issue_id, ir.issue_type, ir.details, NULL AS reported_at, u.id AS reporter_id, u.name AS reporter_name, u.email AS reporter_email FROM issue_reports ir LEFT JOIN users u ON u.id = ir.reported_by ORDER BY ir.issue_id DESC";
    }

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