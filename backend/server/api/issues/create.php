<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['success' => false, 'message' => 'POST requests only.']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);
$issueType = trim((string) ($data['type'] ?? ''));
$details = trim((string) ($data['details'] ?? ''));
$allowedTypes = [
    'Incorrect tree information',
    'Map or GPS problem',
    'Broken feature',
    'Other'
];

if (!in_array($issueType, $allowedTypes, true) || $details === '' || strlen($details) > 500) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Invalid issue report.']);
    exit;
}

try {
    $userResult = $conn->query(
        "SELECT user_id FROM users WHERE username = 'local_user' LIMIT 1"
    );
    $user = $userResult->fetch_assoc();

    if (!$user) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'The local user is missing.']);
        exit;
    }

    $reportedBy = (int) $user['user_id'];
    $statement = $conn->prepare(
        'INSERT INTO issue_reports (issue_type, details, reported_by) VALUES (?, ?, ?)'
    );
    $statement->bind_param('ssi', $issueType, $details, $reportedBy);
    $statement->execute();

    http_response_code(201);
    echo json_encode([
        'success' => true,
        'issue_id' => $conn->insert_id,
        'message' => 'Issue report saved successfully.'
    ]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to save the issue report.']);
}
