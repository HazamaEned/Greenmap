<?php
$servername = "26.137.114.176";
$username = "root";
$password = "admin";
$dbname = "greenmap_db";

// Create connection
$conn = new mysqli($servername, $username, $password, $dbname);

// Check connection
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

echo "Connected successfully!";
?>