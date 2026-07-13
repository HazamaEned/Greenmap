<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../connection.php';

function localUser(mysqli $conn): ?array
{
    $result = $conn->query(
        "SELECT user_id, username, display_name, email, phone,
                email_notifications, tracking_alerts
         FROM users WHERE username = 'local_user' LIMIT 1"
    );

    return $result->fetch_assoc() ?: null;
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $user = localUser($conn);
        if (!$user) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Profile not found.']);
            exit;
        }

        echo json_encode([
            'success' => true,
            'profile' => [
                'name' => $user['display_name'] ?: $user['username'],
                'email' => $user['email'],
                'phone' => $user['phone'] ?: '',
                'emailNotifications' => (bool) $user['email_notifications'],
                'trackingAlerts' => (bool) $user['tracking_alerts']
            ]
        ]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'PUT') {
        http_response_code(405);
        header('Allow: GET, PUT');
        echo json_encode(['success' => false, 'message' => 'GET or PUT requests only.']);
        exit;
    }

    $data = json_decode(file_get_contents('php://input'), true);
    $name = trim((string) ($data['name'] ?? ''));
    $email = trim((string) ($data['email'] ?? ''));
    $phone = trim((string) ($data['phone'] ?? ''));
    $emailNotifications = !empty($data['emailNotifications']) ? 1 : 0;
    $trackingAlerts = !empty($data['trackingAlerts']) ? 1 : 0;

    if (
        $name === '' || strlen($name) > 100 ||
        !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255 ||
        strlen($phone) > 30
    ) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Invalid profile information.']);
        exit;
    }

    $statement = $conn->prepare(
        "UPDATE users
         SET display_name = ?, email = ?, phone = ?,
             email_notifications = ?, tracking_alerts = ?
         WHERE username = 'local_user'"
    );
    $statement->bind_param(
        'sssii', $name, $email, $phone, $emailNotifications, $trackingAlerts
    );
    $statement->execute();

    echo json_encode(['success' => true, 'message' => 'Profile saved successfully.']);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to access the profile.']);
}
