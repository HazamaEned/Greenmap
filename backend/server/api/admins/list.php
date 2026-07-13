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
    $result = $conn->query(
        "SELECT id, name, email, role, created_at
         FROM users
         WHERE role IN ('admin', 'superadmin')
         ORDER BY FIELD(role, 'superadmin', 'admin'), name ASC"
    );

    $admins = [];
    while ($row = $result->fetch_assoc()) {
        $admins[] = [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'email' => $row['email'],
            'role' => $row['role'],
            'createdAt' => $row['created_at'],
        ];
    }

    echo json_encode(['success' => true, 'admins' => $admins]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load administrator accounts.']);
}
