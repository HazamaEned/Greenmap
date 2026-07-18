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

$data = json_decode(file_get_contents('php://input'), true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON request body is required.']);
    exit;
}

$email = trim((string) ($data['email'] ?? ''));
$password = (string) ($data['password'] ?? '');

if ($email === '' || $password === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid email and password are required.']);
    exit;
}

try {
    $statement = $conn->prepare(
        'SELECT id, name, password, role,
            (SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = "users" AND COLUMN_NAME = "status"
            ) AS status_exists,
            status
         FROM users
         WHERE email = ?
         LIMIT 1'
    );
    $statement->bind_param('s', $email);
    $statement->execute();
    $user = $statement->get_result()->fetch_assoc();

    // Same generic message whether the email doesn't exist or the password
    // is wrong, so a login attempt can't be used to discover valid emails.
    if (!$user || !password_verify($password, $user['password'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Incorrect email or password.']);
        exit;
    }

    // Only staff accounts may authenticate. The exact database role is kept
    // in the session so superadmin-only endpoints can enforce authorization.
    if (!in_array($user['role'], ['admin', 'superadmin'], true)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Admin accounts only.']);
        exit;
    }

    if (($user['status_exists'] ?? false) && ($user['status'] ?? 'active') === 'inactive') {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'This account is inactive.']);
        exit;
    }

    startSecureSession();
    session_regenerate_id(true); // prevents session fixation on privilege change
    $sessionRole = $user['role'];
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['name'] = $user['name'];
    $_SESSION['role'] = $sessionRole;

    echo json_encode([
        'success' => true,
        'user' => [
            'id' => (int) $user['id'],
            'name' => $user['name'],
            'role' => $sessionRole
        ]
    ]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to log in.']);
}
