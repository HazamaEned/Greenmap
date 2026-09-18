<?php

$envPath = __DIR__ . '/../../.env';
if (file_exists($envPath)) {
    require_once __DIR__ . '/../../env_loader.php';
    loadEnv($envPath);
}

$host    = getenv('DB_HOST') ?: ($_ENV['DB_HOST'] ?? null);
$port    = (int) (getenv('DB_PORT') ?: ($_ENV['DB_PORT'] ?? 4000));
$user    = getenv('DB_USER') ?: ($_ENV['DB_USER'] ?? null);
$pass    = getenv('DB_PASS') ?: ($_ENV['DB_PASS'] ?? null);
$dbname  = getenv('DB_NAME') ?: ($_ENV['DB_NAME'] ?? null);
$sslCa   = getenv('DB_SSL_CA') ?: ($_ENV['DB_SSL_CA'] ?? null);

$conn = mysqli_init();
mysqli_ssl_set($conn, null, null, $sslCa, null, null);

$success = mysqli_real_connect($conn, $host, $user, $pass, $dbname, $port, null, MYSQLI_CLIENT_SSL);

if (!$success) {
    die("Connection failed: " . mysqli_connect_error());
}