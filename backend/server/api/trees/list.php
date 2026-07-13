<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';

try {
    $result = $conn->query(
        'SELECT
            trees.tree_id AS id,
            trees.common_name AS name,
            trees.species_name AS species,
            trees.origin_status AS status,
            trees.is_active AS active,
            trees.latitude AS lat,
            trees.longitude AS lon,
            trees.planted_date AS planted,
            trees.image_path AS img,
            users.username AS addedBy
        FROM trees
        INNER JOIN users ON users.user_id = trees.submitted_by
        ORDER BY trees.created_at DESC'
    );

    $trees = $result->fetch_all(MYSQLI_ASSOC);

    foreach ($trees as &$tree) {
        $tree['id'] = (int) $tree['id'];
        $tree['active'] = (bool) $tree['active'];
        $tree['lat'] = (float) $tree['lat'];
        $tree['lon'] = (float) $tree['lon'];
    }
    unset($tree);

    echo json_encode(['success' => true, 'trees' => $trees]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load trees.']);
}
