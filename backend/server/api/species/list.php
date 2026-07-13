<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';

try {
    $result = $conn->query(
        'SELECT
            species_id AS id,
            common_name AS name,
            scientific_name AS scientificName,
            image_path AS img
         FROM species
         ORDER BY common_name ASC'
    );

    $species = $result->fetch_all(MYSQLI_ASSOC);
    foreach ($species as &$item) {
        $item['id'] = (int) $item['id'];
    }
    unset($item);

    echo json_encode(['success' => true, 'species' => $species]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load the species catalog.']);
}
