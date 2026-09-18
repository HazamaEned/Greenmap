<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../sessions-helper.php';
sendCorsHeaders();

$user = requireLogin();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['success' => false, 'message' => 'GET requests only.']);
    exit;
}

echo json_encode([
    'success' => true,
    'profile' => [
        'name' => $user['name'],
        'role' => $user['role']
    ]
]);
