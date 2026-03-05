import * as userService from "../services/userService";
import { hashPassword, verifyPassword } from "../utils/security";

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? "admin@store.com";
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? "admin123";
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME ?? "Super Admin";

export const ensureSuperAdminUser = async (): Promise<void> => {
  const email = SUPER_ADMIN_EMAIL.trim().toLowerCase();
  if (!email) {
    throw new Error("SUPER_ADMIN_EMAIL is required");
  }

  const existing = await userService.findUserByEmail(email);

  if (!existing) {
    await userService.createUser({
      email,
      password: hashPassword(SUPER_ADMIN_PASSWORD),
      name: SUPER_ADMIN_NAME,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      permissions: ["*"],
    });
    return;
  }

  const needsRoleFix = existing.role !== "SUPER_ADMIN";
  const needsStatusFix = existing.status !== "ACTIVE";
  const currentPermissions = Array.isArray(existing.permissions)
    ? existing.permissions
    : [];
  const needsPermissionFix =
    currentPermissions.length !== 1 || currentPermissions[0] !== "*";
  const storedPassword =
    typeof existing.password === "string" ? existing.password : "";
  const needsPasswordFix = !verifyPassword(SUPER_ADMIN_PASSWORD, storedPassword);

  if (needsRoleFix || needsStatusFix || needsPermissionFix || needsPasswordFix) {
    await userService.updateUserById(existing.id as string, {
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      permissions: ["*"],
      password: needsPasswordFix ? hashPassword(SUPER_ADMIN_PASSWORD) : undefined,
    });
  }
};
