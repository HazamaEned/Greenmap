USE greenmap_db;

-- Fresh-start reset for entered tree records only.
-- Keeps user accounts, barangays, and species catalog intact.
-- Run a database backup before executing this file.

SELECT COUNT(*) AS tree_data_before FROM tree_data;
SELECT COUNT(*) AS tree_submissions_before FROM tree_submissions;

START TRANSACTION;

DELETE FROM tree_submissions;
DELETE FROM tree_data;

COMMIT;

ALTER TABLE tree_submissions AUTO_INCREMENT = 1;
ALTER TABLE tree_data AUTO_INCREMENT = 1;

SELECT COUNT(*) AS tree_data_after FROM tree_data;
SELECT COUNT(*) AS tree_submissions_after FROM tree_submissions;
