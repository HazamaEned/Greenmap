<?php

/**
 * Cloudinary Helper for GreenMap
 * Handles uploading tree photos to Cloudinary with fallback to local storage.
 */

declare(strict_types=1);

/**
 * Retrieves the Cloudinary credentials from the environment.
 * Supports either CLOUDINARY_URL or individual variables.
 *
 * @return array{cloud_name: string, api_key: string, api_secret: string}|null
 */
function getCloudinaryConfig(): ?array
{
    // Check for CLOUDINARY_URL (e.g. cloudinary://123456789:abcdefgh@my-cloud)
    $cloudinaryUrl = getenv('CLOUDINARY_URL') ?: ($_ENV['CLOUDINARY_URL'] ?? null);

    if (!empty($cloudinaryUrl)) {
        $parsed = parse_url((string) $cloudinaryUrl);
        if ($parsed && !empty($parsed['host']) && !empty($parsed['user']) && !empty($parsed['pass'])) {
            return [
                'cloud_name' => (string) $parsed['host'],
                'api_key'    => (string) $parsed['user'],
                'api_secret' => (string) $parsed['pass'],
            ];
        }
    }

    $cloudName = getenv('CLOUDINARY_CLOUD_NAME') ?: ($_ENV['CLOUDINARY_CLOUD_NAME'] ?? null);
    $apiKey    = getenv('CLOUDINARY_API_KEY')    ?: ($_ENV['CLOUDINARY_API_KEY'] ?? null);
    $apiSecret = getenv('CLOUDINARY_API_SECRET') ?: ($_ENV['CLOUDINARY_API_SECRET'] ?? null);

    if (!empty($cloudName) && !empty($apiKey) && !empty($apiSecret)) {
        return [
            'cloud_name' => (string) $cloudName,
            'api_key'    => (string) $apiKey,
            'api_secret' => (string) $apiSecret,
        ];
    }

    return null;
}

/**
 * Returns true if Cloudinary credentials are fully configured.
 */
function isCloudinaryConfigured(): bool
{
    return getCloudinaryConfig() !== null;
}

/**
 * Uploads an image file to Cloudinary using their REST API.
 *
 * @param string $localFilePath The path to the uploaded temporary file
 * @param string $fileName      The original filename (used for MIME type or public ID)
 * @param string $folder        Cloudinary folder name (defaults to 'greenmap/trees')
 * @return string The HTTPS secure_url of the uploaded image
 * @throws RuntimeException if Cloudinary is not configured or upload fails
 */
function uploadToCloudinary(string $localFilePath, string $fileName = '', string $folder = 'greenmap/trees'): string
{
    $config = getCloudinaryConfig();
    if (!$config) {
        throw new RuntimeException('Cloudinary credentials are not configured.');
    }

    if (!is_file($localFilePath) || !is_readable($localFilePath)) {
        throw new RuntimeException('File to upload does not exist or is not readable.');
    }

    $cloudName = $config['cloud_name'];
    $apiKey    = $config['api_key'];
    $apiSecret = $config['api_secret'];
    $timestamp = time();

    // Parameters to sign in alphabetical order
    $paramsToSign = [
        'folder'    => $folder,
        'timestamp' => $timestamp,
    ];
    ksort($paramsToSign);

    $signString = '';
    foreach ($paramsToSign as $key => $value) {
        $signString .= ($signString === '' ? '' : '&') . $key . '=' . $value;
    }
    $signature = sha1($signString . $apiSecret);

    $endpoint = "https://api.cloudinary.com/v1_1/{$cloudName}/image/upload";

    $detectedMime = 'image/jpeg';
    if (class_exists('finfo')) {
        $detected = (new finfo(FILEINFO_MIME_TYPE))->file($localFilePath);
        if ($detected) $detectedMime = $detected;
    } elseif (function_exists('mime_content_type')) {
        $detected = mime_content_type($localFilePath);
        if ($detected) $detectedMime = $detected;
    }

    $postData = [
        'file'      => new CURLFile($localFilePath, $detectedMime, $fileName ?: basename($localFilePath)),
        'api_key'   => $apiKey,
        'timestamp' => (string) $timestamp,
        'signature' => $signature,
        'folder'    => $folder,
    ];

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $endpoint,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postData,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT        => 45,
    ]);

    $rawResponse = curl_exec($ch);
    $httpCode    = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError   = curl_error($ch);
    curl_close($ch);

    if ($rawResponse === false || !empty($curlError)) {
        throw new RuntimeException('Failed to connect to Cloudinary: ' . $curlError);
    }

    $responseData = json_decode((string) $rawResponse, true);
    if (!is_array($responseData)) {
        throw new RuntimeException('Invalid JSON response received from Cloudinary.');
    }

    if ($httpCode !== 200 || empty($responseData['secure_url'])) {
        $errMsg = $responseData['error']['message'] ?? "Upload failed with HTTP code {$httpCode}";
        throw new RuntimeException('Cloudinary upload error: ' . $errMsg);
    }

    return (string) $responseData['secure_url'];
}

