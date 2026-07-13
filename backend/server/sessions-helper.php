<?php

// Centralized session configuration and auth helpers.
// Required by any endpoint that needs to know who's logged in.

function startSecureSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax'
        // 'secure' => true, // enable once served over HTTPS
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