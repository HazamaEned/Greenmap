<?php

// Centralized session configuration and auth helpers.
// Required by any endpoint that needs to know who's logged in.

function sendCorsHeaders(): void
{
    $allowedOrigins = [
        'https://greenmap-eta.vercel.app',
        'http://localhost:5500', // adjust/remove if you test locally with a different setup
    ];

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if (in_array($origin, $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }

    // Preflight requests (OPTIONS) just need the headers above, then can stop here.
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function startSecureSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'None',
        'secure' => true,
    ]);

    session_start();
}

function currentUser(): ?array
{
    startSecureSession();

    if (!isset($_SESSION['user_id'])) {
        return null;
    }

    return [
        'id' => (int) $_SESSION['user_id'],
        'name' => $_SESSION['name'],
        'role' => $_SESSION['role']
    ];
}

// Ends the request with a 401 JSON response if nobody is logged in.
function requireLogin(): array
{
    $user = currentUser();

    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'You must be logged in.']);
        exit;
    }

    return $user;
}

// Ends the request with a 403 JSON response if the logged-in user's role
// isn't in the allowed list. Always checks login first.
function requireRole(array $allowedRoles): array
{
    $user = requireLogin();

    if (!in_array($user['role'], $allowedRoles, true)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'You do not have permission to do this.']);
        exit;
    }

    return $user;
}