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

// Only superadmins may change report status
$user = requireRole(['superadmin']);

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON body is required.']);
    exit;
}

$issueId = isset($input['issue_id']) ? (int)$input['issue_id'] : 0;
$action = isset($input['action']) ? (string)$input['action'] : '';

if ($issueId <= 0 || $action === '') {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'issue_id and action are required.']);
    exit;
}

// Ensure columns exist (for older installs); try to add them if missing.
try {
    $conn->query("ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Unread'");
} catch (mysqli_sql_exception $e) {
    // ignore — best-effort
}

try {
    switch ($action) {
        case 'mark_read':
            $stmt = $conn->prepare('UPDATE issue_reports SET status = ? WHERE issue_id = ?');
            $s = 'Read';
            $stmt->bind_param('si', $s, $issueId);
            $stmt->execute();
            break;
        case 'mark_unread':
            $stmt = $conn->prepare('UPDATE issue_reports SET status = ? WHERE issue_id = ?');
            $s = 'Unread';
            $stmt->bind_param('si', $s, $issueId);
            $stmt->execute();
            break;
        default:
            http_response_code(422);
            echo json_encode(['success' => false, 'message' => 'Unknown action.']);
            exit;
    }

    echo json_encode(['success' => true, 'message' => 'Report updated.']);
} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Could not update report.']);
}
