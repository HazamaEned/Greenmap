-- Migration: Add area_type to tree_submissions table
-- Description: Identifier for Public vs Private area/property in tree action reports

ALTER TABLE `tree_submissions`
ADD COLUMN `area_type` ENUM('Public', 'Private') NOT NULL DEFAULT 'Public'
AFTER `address`;

-- Optional: If you also want to record area_type on the persistent tree_data entity
-- ALTER TABLE `tree_data`
-- ADD COLUMN `area_type` ENUM('Public', 'Private') NOT NULL DEFAULT 'Public'
-- AFTER `tree_status`;

