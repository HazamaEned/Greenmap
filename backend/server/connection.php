<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/../../env_loader.php';
loadEnv(__DIR__ . '/../../.env');

$host    = $_ENV['DB_HOST'] ?? null;
$port    = (int) ($_ENV['DB_PORT'] ?? 0);
$user    = $_ENV['DB_USER'] ?? null;
$pass    = $_ENV['DB_PASS'] ?? null;
$dbname  = $_ENV['DB_NAME'] ?? null;
$sslCa   = $_ENV['DB_SSL_CA'] ?? null;

var_dump($host, $port, $user, $pass, $dbname, $sslCa);
die();


$conn = mysqli_init();

mysqli_ssl_set($conn, null, null, $sslCa, null, null);

$success = mysqli_real_connect(
    $conn,
    $host,
    $user,
    $pass,
    $dbname,
    $port,
    null,
    MYSQLI_CLIENT_SSL
);

if (!$success) {
    die("Connection failed: " . mysqli_connect_error());
}