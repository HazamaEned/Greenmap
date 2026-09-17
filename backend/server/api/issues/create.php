<?php

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../../connection.php';
require __DIR__ . '/../../sessions-helper.php';
sendCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['success' => false, 'message' => 'POST requests only.']);
    exit;
}

// Issue reports may be submitted by anonymous visitors or logged-in users.
$user = currentUser();

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'A valid JSON body is required.']);
    exit;
}

$issueType = trim((string)($input['issue_type'] ?? ''));
$severity = trim((string)($input['severity'] ?? ''));
$affected_feature = isset($input['affected_feature']) ? trim((string)$input['affected_feature']) : '';
$steps = isset($input['steps']) ? trim((string)$input['steps']) : '';
$additional = isset($input['additional']) ? trim((string)$input['additional']) : '';

if ($issueType === '') {
    http_response_code(422);
    echo json_encode(['success' => false, 'message' => 'Issue type is required.']);
    exit;
}

$reporterId = $user ? $user['id'] : null;
$reporterName = $user ? $user['name'] : '';
$reporterEmail = ''; // Will be looked up from DB if we have a reporterId.

// Lookup reporter email from users table only if the reporter is logged in
if ($reporterId !== null) {
    try {
        $stmt = $conn->prepare('SELECT email FROM users WHERE id = ? LIMIT 1');
        $stmt->bind_param('i', $reporterId);
        $stmt->execute();
        $reporter = $stmt->get_result()->fetch_assoc();
        $reporterEmail = $reporter['email'] ?? '';
    } catch (mysqli_sql_exception $e) {
        // Non-critical error, proceed without reporter email.
    }
}

$details = '';
if ($additional !== '') {
    // If 'additional' is present, it's likely from the simple dialog. Use it as the main details.
    $details = $additional;
} else {
    // Otherwise, build details from the structured report form.
    $detailsParts = [];
    $detailsParts[] = "Severity: " . ($severity ?: 'Not specified');
    if ($affected_feature !== '') $detailsParts[] = "Affected: " . $affected_feature;
    if ($steps !== '') $detailsParts[] = "Steps to reproduce: " . $steps;
    $details = implode("\n\n", $detailsParts);
}

if (trim($details) === '') {
    $details = 'No details provided.';
}

// Save to database
try {
    if ($reporterId === null) {
        $insert = $conn->prepare('INSERT INTO issue_reports (issue_type, details) VALUES (?, ?)');
        $insert->bind_param('ss', $issueType, $details);
    } else {
        $insert = $conn->prepare('INSERT INTO issue_reports (issue_type, details, reported_by) VALUES (?, ?, ?)');
        $insert->bind_param('ssi', $issueType, $details, $reporterId);
    }
    $insert->execute();
    $issueId = $insert->insert_id;
} catch (mysqli_sql_exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Could not save the report.']);
    exit;
}

// If the table does not yet have status/archived columns (older installs), ensure defaults exist
try {
    $conn->query("ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Unread'");
    $conn->query("ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS archived TINYINT(1) NOT NULL DEFAULT 0");
} catch (mysqli_sql_exception $e) {
    // Non-fatal — the columns are an enhancement for the admin UI. Proceed without blocking the user.
}

// Send email to superadmin
$to = 'juson_christianbenedict@plpasig.edu.ph';
$subject = "[GreenMap] New issue report (#{$issueId}) - " . $issueType;

$fullDetails = $details;
if ($additional !== '' && $steps !== '') {
    // Re-compose for email if both simple and structured fields were sent
    $fullDetails = "Steps to reproduce:\n{$steps}\n\nAdditional details:\n{$additional}";
}

$emailBody = "A new issue report was submitted via GreenMap.\n\n";
$emailBody .= "Issue ID: {$issueId}\n";
$emailBody .= "Issue type: {$issueType}\n";
$emailBody .= "Severity: " . ($severity ?: 'Not specified') . "\n\n";
$emailBody .= "Reporter: " . ($reporterName ?: 'Unknown') . "\n";
$emailBody .= "Reporter email: " . ($reporterEmail ?: 'Unknown') . "\n\n";
$emailBody .= "Details:\n" . $fullDetails . "\n\n";
$emailBody .= "--\nGreenMap automated report";

$headers = [];
$headers[] = 'From: GreenMap <no-reply@greenmap.local>';
if ($reporterEmail) $headers[] = 'Reply-To: ' . $reporterEmail;
$headers[] = 'Content-Type: text/plain; charset=utf-8';

// Attempt to send — suppress warnings; whether mail() actually delivers depends on PHP/mail server config.
@mail($to, $subject, $emailBody, implode("\r\n", $headers));

echo json_encode(['success' => true, 'message' => 'Report submitted. Thank you for reporting the issue.']);
