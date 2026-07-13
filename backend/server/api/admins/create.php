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

requireRole(['superadmin']);
$data = json_decode(file_get_contents('php://input'), true);
$name = trim((string) ($data['name'] ?? ''));
$email = trim((string) ($data['email'] ?? ''));
$password = (string) ($data['password'] ?? '');

if (
    $name === '' || mb_strlen($name) > 100 ||
    !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 255 ||
    strlen($password) < 8 || strlen($password) > 128
) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Enter a valid name, email, and password of at least 8 characters.']);
    exit;
}

try {
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    $role = 'admin';
    $statement = $conn->prepare(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
    );
    $statement->bind_param('ssss', $name, $email, $passwordHash, $role);
    $statement->execute();

    http_response_code(201);
    echo json_encode([
        'success' => true,
        'admin' => [
            'id' => (int) $conn->insert_id,
            'name' => $name,
            'email' => $email,
            'role' => $role,
        ],
        'message' => 'Administrator account created.',
    ]);
} catch (mysqli_sql_exception $exception) {
    if ((int) $exception->getCode() === 1062) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'An account with that email already exists.']);
        exit;
    }

    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to create the administrator account.']);
}
