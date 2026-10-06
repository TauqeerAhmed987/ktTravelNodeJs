-- KT Travel audit fixes — run ONCE on every database (local XAMPP, Railway, cPanel MySQL).
-- Works on MySQL 5.7+/8 and MariaDB 10.4+. Take a backup first.
--
--   mysql -u<user> -p <database> < 2026-10-06_audit_fixes.sql
--
-- What it adds
--   bookings.guest_name / guest_email / guest_phone  (#6 guest details saved on the booking itself)
--   bookings.comments                                (#9 checkout comments)
--   bookings.status / cancelled_at / cancel_reason   (#8 cancel -> inventory is restored)
--   booking_transactions                             (#4 record of every payment, refund and overpayment)

ALTER TABLE `bookings`
  ADD COLUMN `guest_name`    VARCHAR(255) NULL AFTER `user_id`,
  ADD COLUMN `guest_email`   VARCHAR(255) NULL AFTER `guest_name`,
  ADD COLUMN `guest_phone`   VARCHAR(50)  NULL AFTER `guest_email`,
  ADD COLUMN `comments`      TEXT         NULL,
  ADD COLUMN `status`        VARCHAR(20)  NOT NULL DEFAULT 'active',
  ADD COLUMN `cancelled_at`  TIMESTAMP    NULL DEFAULT NULL,
  ADD COLUMN `cancel_reason` TEXT         NULL;

CREATE TABLE IF NOT EXISTS `booking_transactions` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id`       INT(11)         NOT NULL,
  `schedule_id`      BIGINT UNSIGNED NULL,
  -- deposit | installment | overpayment | refund | refund_due
  `type`             VARCHAR(20)     NOT NULL,
  -- succeeded | refund_due | failed
  `status`           VARCHAR(20)     NOT NULL DEFAULT 'succeeded',
  `amount`           DECIMAL(10,2)   NOT NULL,
  `stripe_charge_id` VARCHAR(255)    NULL,
  `stripe_refund_id` VARCHAR(255)    NULL,
  `note`             TEXT            NULL,
  `created_at`       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `booking_transactions_booking_id_index` (`booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill: guest details for bookings made before this change (taken from the linked user)
UPDATE `bookings` b
  JOIN `users` u ON u.`id` = b.`user_id`
SET b.`guest_name`  = u.`name`,
    b.`guest_email` = u.`email`,
    b.`guest_phone` = u.`client_phone`
WHERE b.`guest_name` IS NULL;

-- Backfill: the deposit and every installment already paid, so history is not empty for old bookings
INSERT INTO `booking_transactions` (`booking_id`, `type`, `status`, `amount`, `note`, `created_at`)
SELECT b.`booking_id`, 'deposit', 'succeeded', CAST(b.`total_amount_after_percent` AS DECIMAL(10,2)),
       'Backfilled from the booking record', b.`created_at`
FROM `bookings` b
WHERE b.`total_amount_after_percent` IS NOT NULL
  AND b.`total_amount_after_percent` <> ''
  AND CAST(b.`total_amount_after_percent` AS DECIMAL(10,2)) > 0;

INSERT INTO `booking_transactions` (`booking_id`, `schedule_id`, `type`, `status`, `amount`, `stripe_charge_id`, `note`, `created_at`)
SELECT s.`booking_id`, s.`id`, 'installment', 'succeeded', s.`amount`, s.`stripe_charge_id`,
       'Backfilled from the payment schedule', COALESCE(s.`paid_at`, s.`updated_at`, NOW())
FROM `payment_schedules` s
WHERE s.`status` = 'paid';
