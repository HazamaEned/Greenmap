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

// Only superadmins can view the list of admins.
requireRole(['superadmin']);

try {
    // Ensure the 'status' column is selected.
    $result = $conn->query(
        'SELECT id, name, email, role, status FROM users
         WHERE role IN ("admin", "superadmin")
         ORDER BY name ASC'
    );

    $admins = $result->fetch_all(MYSQLI_ASSOC);

    echo json_encode(['success' => true, 'admins' => $admins]);
} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error while fetching admin accounts.']);
}