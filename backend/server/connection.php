<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/../../env_loader.php';
loadEnv(__DIR__ . '/../../.env');

$host    = getenv('DB_HOST');
$port    = (int) getenv('DB_PORT');
$user    = getenv('DB_USER');
$pass    = getenv('DB_PASS');
$dbname  = getenv('DB_NAME');
$sslCa   = getenv('DB_SSL_CA');

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