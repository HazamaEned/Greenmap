USE greenmap_db;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(100) NULL AFTER username,
    ADD COLUMN IF NOT EXISTS phone VARCHAR(30) NULL AFTER email,
    ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE AFTER password_hash,
    ADD COLUMN IF NOT EXISTS tracking_alerts BOOLEAN NOT NULL DEFAULT FALSE AFTER email_notifications;

CREATE TABLE IF NOT EXISTS issue_reports (
    issue_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    issue_type VARCHAR(50) NOT NULL,
    details VARCHAR(500) NOT NULL,
    reported_by INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_issue_reports_user (reported_by),
    INDEX idx_issue_reports_created_at (created_at),

    CONSTRAINT fk_issue_reports_user
        FOREIGN KEY (reported_by)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB;
