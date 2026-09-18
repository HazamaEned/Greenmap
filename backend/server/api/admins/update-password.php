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

$user = requireRole(['admin', 'superadmin']);

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON body is required.']);
    exit;
}

try {
    // Scenario 1: Superadmin resetting another admin's password
    if (isset($input['admin_id']) && $user['role'] === 'superadmin') {
        $adminId = filter_var($input['admin_id'], FILTER_VALIDATE_INT);
        $newPassword = (string)($input['password'] ?? '');
        if ($adminId === false || $adminId <= 0 || strlen($newPassword) < 8) {
            http_response_code(422);
            echo json_encode(['success' => false, 'message' => 'A valid admin ID and a new password of at least 8 characters are required.']);
            exit;
        }
        $newPasswordHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $updateStmt = $conn->prepare('UPDATE users SET password = ? WHERE id = ?');
        $updateStmt->bind_param('si', $newPasswordHash, $adminId);
        $updateStmt->execute();
        echo json_encode(['success' => true, 'message' => 'Administrator password has been updated.']);
        exit;
    }

    // Scenario 2: Current user changing their own password
    $currentPassword = (string)($input['current_password'] ?? '');
    $newPassword = (string)($input['new_password'] ?? '');

    if ($currentPassword === '' || strlen($newPassword) < 8 || strlen($newPassword) > 128) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Please provide your current password and a new password of at least 8 characters.']);
        exit;
    }

    $stmt = $conn->prepare('SELECT password FROM users WHERE id = ? LIMIT 1');
    $stmt->bind_param('i', $user['id']);
    $stmt->execute();
    $dbUser = $stmt->get_result()->fetch_assoc();

    if (!$dbUser || !password_verify($currentPassword, $dbUser['password'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Your current password is not correct.']);
        exit;
    }

    $newPasswordHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $updateStmt = $conn->prepare('UPDATE users SET password = ? WHERE id = ?');
    $updateStmt->bind_param('si', $newPasswordHash, $user['id']);
    $updateStmt->execute();

    echo json_encode(['success' => true, 'message' => 'Your password has been updated successfully.']);

} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'A database error occurred while updating your password.']);
}