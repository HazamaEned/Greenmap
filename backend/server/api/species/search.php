<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';
sendCorsHeaders();

$query = trim((string) ($_GET['q'] ?? ''));
$limit = filter_var($_GET['limit'] ?? 20, FILTER_VALIDATE_INT);
$limit = $limit !== false ? max(1, min($limit, 100)) : 20;

try {
    $statement = $conn->prepare(
        'SELECT
            species_id,
            common_name,
            scientific_name,
            origin_status
        FROM species
        WHERE ? = \'\'
           OR common_name LIKE CONCAT(\'%\', ?, \'%\')
           OR scientific_name LIKE CONCAT(\'%\', ?, \'%\')
        ORDER BY common_name ASC
        LIMIT ?'
    );
    $statement->bind_param('sssi', $query, $query, $query, $limit);
    $statement->execute();
    $result = $statement->get_result();

    $species = [];
    while ($row = $result->fetch_assoc()) {
        $species[] = [
            'speciesId' => (int) $row['species_id'],
            'commonName' => $row['common_name'],
            'scientificName' => $row['scientific_name'],
            'originStatus' => $row['origin_status'],
        ];
    }

    echo json_encode(['success' => true, 'species' => $species]);
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Unable to load the species catalog.']);
}
