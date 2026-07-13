USE greenmap_db;

CREATE TABLE IF NOT EXISTS species (
    species_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    common_name VARCHAR(100) NOT NULL,
    scientific_name VARCHAR(150) NOT NULL,
    image_path VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX uq_species_scientific_name (scientific_name),
    INDEX idx_species_common_name (common_name)
) ENGINE=InnoDB;

INSERT INTO species (common_name, scientific_name, image_path) VALUES
    ('Narra', 'Pterocarpus indicus', 'trees/narra.jpg'),
    ('Samanea', 'Samanea saman', 'trees/samanea.jpg'),
    ('Agoho', 'Casuarina equisetifolia', 'trees/agoho.jpg'),
    ('Guava', 'Psidium guajava L.', 'trees/bayabas.jpg'),
    ('Santol', 'Sandoricum koetjape', 'trees/santol.jpg'),
    ('Mango', 'Mangifera indica L.', 'trees/mango.jpg'),
    ('Kamias', 'Averrhoa bilimbi', 'trees/kamias.jpg')
ON DUPLICATE KEY UPDATE
    common_name = VALUES(common_name),
    image_path = VALUES(image_path);
