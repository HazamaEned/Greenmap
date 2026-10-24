<?php

// Centralized session configuration and auth helpers.
// Required by any endpoint that needs to know who's logged in.

function getSecretKey(): string
{
    return (string) (getenv('APP_SECRET') ?: (getenv('DB_PASS') ?: 'greenmap_secure_token_secret_2026_pasig'));
}

function base64UrlEncode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode(string $data): string
{
    return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
}

function createSessionToken(array $userData, int $ttlSeconds = 2592000): string
{
    $payload = [
        'user_id' => (int) $userData['user_id'],
        'name'    => (string) $userData['name'],
        'role'    => (string) $userData['role'],
        'iat'     => time(),
        'exp'     => time() + $ttlSeconds
    ];
    $payloadEncoded = base64UrlEncode((string) json_encode($payload, JSON_UNESCAPED_SLASHES));
    $signature = hash_hmac('sha256', $payloadEncoded, getSecretKey());
    return $payloadEncoded . '.' . $signature;
}

function verifySessionToken(string $token): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 2) {
        return null;
    }
    [$payloadEncoded, $signature] = $parts;
    $expectedSignature = hash_hmac('sha256', $payloadEncoded, getSecretKey());
    if (!hash_equals($expectedSignature, $signature)) {
        return null;
    }
    $json = base64UrlDecode($payloadEncoded);
    $payload = json_decode($json, true);
    if (!is_array($payload) || !isset($payload['user_id'], $payload['role'], $payload['exp'])) {
        return null;
    }
    if (time() > $payload['exp']) {
        return null; // Expired
    }
    return $payload;
}

function getProvidedSessionToken(): ?string
{
    $token = $_SERVER['HTTP_X_SESSION_ID'] ?? null;
    if ($token && strlen(trim((string) $token)) > 0) {
        return trim((string) $token);
    }

    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null);
    if ($auth && preg_match('/^Bearer\s+(.+)$/i', (string) $auth, $m)) {
        return trim($m[1]);
    }

    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $key => $val) {
            if (strcasecmp($key, 'X-Session-Id') === 0 || strcasecmp($key, 'Session-Id') === 0) {
                if (!empty($val)) return trim((string) $val);
            }
            if (strcasecmp($key, 'Authorization') === 0 && preg_match('/^Bearer\s+(.+)$/i', (string) $val, $m)) {
                return trim($m[1]);
            }
        }
    }

    if (!empty($_COOKIE['greenmap_session'])) {
        return trim((string) $_COOKIE['greenmap_session']);
    }

    return null;
}

function sendCorsHeaders(): void
{
    $allowedOrigins = [
        'https://greenmap-eta.vercel.app',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
    ];

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    $isAllowed = in_array($origin, $allowedOrigins, true)
        || preg_match('/^https:\/\/[a-z0-9\-]+\.vercel\.app$/i', $origin)
        || preg_match('/^http:\/\/localhost(:\d+)?$/i', $origin)
        || preg_match('/^http:\/\/127\.0\.0\.1(:\d+)?$/i', $origin);

    if ($isAllowed && $origin !== '') {
        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Session-Id, Authorization');
        header('Access-Control-Expose-Headers: X-Session-Id, Authorization');
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

    if (!headers_sent()) {
        ini_set('session.cookie_samesite', 'None');
        ini_set('session.cookie_secure', '1');
        ini_set('session.cookie_httponly', '1');

        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'None',
            'secure'   => true,
        ]);

        // Check if session ID was provided via custom header or Bearer token
        $headerSessionId = getProvidedSessionToken();
        if ($headerSessionId && preg_match('/^[a-zA-Z0-9,-]{16,128}$/', $headerSessionId)) {
            session_id($headerSessionId);
        }

        @session_start();
    }
}

function currentUser(): ?array
{
    // 1. Try resolving from signed session token (cross-site friendly)
    $token = getProvidedSessionToken();
    if ($token) {
        $payload = verifySessionToken($token);
        if ($payload) {
            if (session_status() !== PHP_SESSION_ACTIVE && !headers_sent()) {
                @session_start();
            }
            $_SESSION['user_id'] = $payload['user_id'];
            $_SESSION['name']    = $payload['name'];
            $_SESSION['role']    = $payload['role'];

            return [
                'id'   => (int) $payload['user_id'],
                'name' => (string) $payload['name'],
                'role' => (string) $payload['role']
            ];
        }
    }

    // 2. Fallback to standard PHP session
    startSecureSession();

    if (!isset($_SESSION['user_id'])) {
        return null;
    }

    return [
        'id'   => (int) $_SESSION['user_id'],
        'name' => (string) $_SESSION['name'],
        'role' => (string) $_SESSION['role']
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

// Returns the current user if logged in, or null for anonymous requests.
// Unlike requireLogin(), this does NOT end the request on unauthenticated access.
function getCurrentUserIfLoggedIn(): ?array
{
    return currentUser();
}
