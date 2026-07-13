USE greenmap_db;

INSERT INTO users (username, email, password_hash)
VALUES
    ('UserA', 'usera.sample@greenmap.test', '!disabled-sample-account!'),
    ('UserB', 'userb.sample@greenmap.test', '!disabled-sample-account!'),
    ('UserC', 'userc.sample@greenmap.test', '!disabled-sample-account!')
ON DUPLICATE KEY UPDATE username = VALUES(username);

INSERT INTO trees (
    common_name, species_name, origin_status, is_active,
    latitude, longitude, planted_date, image_path, submitted_by
)
SELECT
    sample.common_name, sample.species_name, sample.origin_status, TRUE,
    sample.latitude, sample.longitude, sample.planted_date, sample.image_path,
    users.user_id
FROM (
    SELECT 'Mango Tree' AS common_name, 'Mangifera indica' AS species_name,
           'Native' AS origin_status, 14.57690000 AS latitude,
           121.08480000 AS longitude, '2012-01-01' AS planted_date,
           'trees/mango.jpg' AS image_path, 'UserA' AS submitted_by_username
    UNION ALL
    SELECT 'Samanea', 'Samanea saman', 'Introduced', 14.57580000,
           121.08600000, '2015-01-01', 'trees/samanea.jpg', 'UserB'
    UNION ALL
    SELECT 'Narra', 'Pterocarpus indicus', 'Native', 14.57710000,
           121.08680000, '2008-01-01', 'trees/narra.jpg', 'UserC'
) AS sample
INNER JOIN users ON users.username = sample.submitted_by_username
WHERE NOT EXISTS (
    SELECT 1 FROM trees
    WHERE trees.common_name = sample.common_name
      AND trees.species_name = sample.species_name
      AND trees.latitude = sample.latitude
      AND trees.longitude = sample.longitude
);

UPDATE trees
INNER JOIN users ON users.username = CASE trees.common_name
    WHEN 'Mango Tree' THEN 'UserA'
    WHEN 'Samanea' THEN 'UserB'
    WHEN 'Narra' THEN 'UserC'
END
SET trees.submitted_by = users.user_id
WHERE (trees.common_name = 'Mango Tree' AND trees.species_name = 'Mangifera indica')
   OR (trees.common_name = 'Samanea' AND trees.species_name = 'Samanea saman')
   OR (trees.common_name = 'Narra' AND trees.species_name = 'Pterocarpus indicus');
