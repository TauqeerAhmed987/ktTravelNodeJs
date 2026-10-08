-- KT Travel — guest change requests. Run ONCE on every database (local XAMPP, Railway, cPanel MySQL),
-- after 2026-10-06_audit_fixes.sql. Works on MySQL 5.7+/8 and MariaDB 10.4+.
--
--   mysql -u<user> -p <database> < 2026-10-08_change_requests.sql
--
-- Until now a guest's "Request a change" from My Booking was only e-mailed; if the e-mail did not
-- arrive the admin never saw it. Every request is now stored and listed in the dashboard.

CREATE TABLE IF NOT EXISTS `booking_change_requests` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id`  INT(11)         NOT NULL,
  `access_code` VARCHAR(255)    NULL,
  `guest_name`  VARCHAR(255)    NULL,
  `guest_email` VARCHAR(255)    NULL,
  `message`     TEXT            NOT NULL,
  -- open | resolved
  `status`      VARCHAR(20)     NOT NULL DEFAULT 'open',
  `admin_note`  TEXT            NULL,
  `created_at`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `booking_change_requests_booking_id_index` (`booking_id`),
  KEY `booking_change_requests_status_index` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
