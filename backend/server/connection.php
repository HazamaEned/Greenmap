<?php

$servername = 'localhost';
$username = 'root';
$password = 'admin';
$dbname = 'greenmap_db';
$port = 3306;

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

try {
    $conn = new mysqli(
        $servername,
        $username,
        $password,
        $dbname,
        $port
    );

    $conn->set_charset('utf8mb4');
} catch (mysqli_sql_exception $exception) {
    http_response_code(500);
    exit('Database connection failed.');
}
