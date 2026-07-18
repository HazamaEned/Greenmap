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

$reviewer = requireRole(['superadmin']);
$data = json_decode(file_get_contents('php://input'), true);
$submissionId = filter_var($data['submission_id'] ?? null, FILTER_VALIDATE_INT);
$decision = (string) ($data['decision'] ?? '');

if ($submissionId === false || $submissionId === null || $submissionId <= 0 || !in_array($decision, ['Approved', 'Rejected'], true)) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid submission and decision are required.']);
    exit;
}

try {
    $conn->begin_transaction();

    $check = $conn->prepare(
        'SELECT submitted_by, approval_status
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
        echo json_encode(['success' => false, 'message' => 'Contribution not found.']);
        exit;
    }

    if ((int) $submission['submitted_by'] === (int) $reviewer['id']) {
        $conn->rollback();
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'You cannot review your own contribution.']);
        exit;
    }

    if ($submission['approval_status'] !== 'Pending') {
        $conn->rollback();
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This contribution has already been reviewed.']);
        exit;
    }

    $update = $conn->prepare(
        'UPDATE tree_submissions
         SET approval_status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE submission_id = ? AND approval_status = \'Pending\''
    );
    $reviewerId = $reviewer['id'];
    $update->bind_param('sii', $decision, $reviewerId, $submissionId);
    $update->execute();
    $conn->commit();
    
    // Post-approval action: If approved, the tree becomes visible on the main map.
    // This logic is currently implicit. If you add a dedicated 'trees' table
    // separate from submissions, this is where you would copy the approved
    // data into that main table. For now, the view used by 'trees/list.php'
    // handles this filtering.


    echo json_encode([
        'success' => true,
        'submissionId' => (int) $submissionId,
        'approvalStatus' => $decision,
        'message' => "Contribution {$decision}.",
    ]);
} catch (mysqli_sql_exception $exception) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to review the contribution.']);
}
