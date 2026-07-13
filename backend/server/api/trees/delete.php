<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';

if ($_SERVER['REQUEST_METHOD'] !== 'DELETE') {
    http_response_code(405);
    header('Allow: DELETE');
    echo json_encode(['success' => false, 'message' => 'DELETE requests only.']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);
$treeId = filter_var($data['tree_id'] ?? null, FILTER_VALIDATE_INT);

if ($treeId === false || $treeId < 1) {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'A valid tree ID is required.']);
    exit;
}

try {
    // Ownership is fixed to the temporary local user until login is added.
    $statement = $conn->prepare(
        "DELETE trees FROM trees
         INNER JOIN users ON users.user_id = trees.submitted_by
         WHERE trees.tree_id = ? AND users.username = 'local_user'"
    );
    $statement->bind_param('i', $treeId);
    $statement->execute();

    if ($statement->affected_rows === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Tree not found.']);
        exit;
    }

    echo json_encode(['success' => true, 'message' => 'Tree removed successfully.']);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to remove the tree.']);
}
