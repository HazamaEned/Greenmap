<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../session_helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['success' => false, 'message' => 'GET requests only.']);
    exit;
}

$user = currentUser();

echo json_encode([
    'success' => true,
    'loggedIn' => $user !== null,
    'user' => $user
]);