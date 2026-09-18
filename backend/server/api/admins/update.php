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

// Only superadmins can activate/deactivate accounts.
$superadmin = requireRole(['superadmin']);

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON body is required.']);
    exit;
}

$adminId = filter_var($input['admin_id'] ?? null, FILTER_VALIDATE_INT);
$status = trim((string)($input['status'] ?? ''));

if (!$adminId || !in_array($status, ['active', 'inactive'], true)) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid admin ID and status are required.']);
    exit;
}

if ($adminId === (int) $superadmin['id'] && $status === 'inactive') {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'You cannot deactivate your own account.']);
    exit;
}

// Add the 'status' column if it doesn't exist, defaulting to 'active'.
try {
    $conn->query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'");
} catch (mysqli_sql_exception $e) {
    // Non-fatal, proceed with the update.
}

try {
    $stmt = $conn->prepare('UPDATE users SET status = ? WHERE id = ? AND role IN ("admin", "superadmin")');
    $stmt->bind_param('si', $status, $adminId);
    $stmt->execute();

    $message = $stmt->affected_rows > 0 ? 'Admin status updated.' : 'Admin not found or no change made.';
    echo json_encode(['success' => true, 'message' => $message]);
} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error while updating admin status.']);
}