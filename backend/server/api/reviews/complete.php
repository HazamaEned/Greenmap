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

$reviewer = requireRole(['superadmin']);
$data = json_decode(file_get_contents('php://input'), true);
$submissionId = filter_var($data['submission_id'] ?? null, FILTER_VALIDATE_INT);

if ($submissionId === false || $submissionId === null || $submissionId <= 0) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid submission ID is required.']);
    exit;
}

try {
    $conn->begin_transaction();

    // Only allow marking Approved submissions as Completed
    $check = $conn->prepare(
        'SELECT approval_status, operational_status
         FROM tree_submissions
         WHERE submission_id = ?
         FOR UPDATE'
    );
    $check->bind_param('i', $submissionId);
    $check->execute();
    $submission = $check->get_result()->fetch_assoc();

    if (!$submission) {
        $conn->rollback();
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Report not found.']);
        exit;
    }

    if ($submission['approval_status'] !== 'Approved') {
        $conn->rollback();
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Only approved reports can be marked as completed.']);
        exit;
    }

    if ($submission['operational_status'] === 'Completed') {
        $conn->rollback();
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This report has already been marked as completed.']);
        exit;
    }

    $completedStatus = 'Completed';
    $update = $conn->prepare(
        'UPDATE tree_submissions
         SET operational_status = ?
         WHERE submission_id = ?'
    );
    $update->bind_param('si', $completedStatus, $submissionId);
    $update->execute();
    $conn->commit();

    echo json_encode([
        'success'           => true,
        'submissionId'      => (int) $submissionId,
        'operationalStatus' => 'Completed',
        'message'           => 'Report marked as completed. The tree action has been recorded as resolved.',
    ]);
} catch (mysqli_sql_exception $exception) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to update the report status.']);
}
