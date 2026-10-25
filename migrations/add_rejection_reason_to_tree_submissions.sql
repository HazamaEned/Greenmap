-- Migration: Add rejection_reason to tree_submissions table
-- Description: Stores the superadmin's reason when denying/rejecting a tree action report

ALTER TABLE `tree_submissions`
ADD COLUMN `rejection_reason` TEXT NULL DEFAULT NULL
AFTER `approval_status`;

