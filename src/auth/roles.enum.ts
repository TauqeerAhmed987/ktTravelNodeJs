// Mirrors the numeric roles used in the current Laravel `users.role` column.
// Roles 3 (Client) and 5 are blocked from the admin dashboard — see LoginController.php:62 in the old system.
export enum Role {
  ADMIN = 1,
  STAFF = 2,
  CLIENT = 3,
  MEMBER = 4,
  BLOCKED_PORTAL = 5,
}

export const DASHBOARD_BLOCKED_ROLES = [Role.CLIENT, Role.BLOCKED_PORTAL];
