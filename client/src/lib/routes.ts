import type { Role } from "../types";

export const homeFor: Record<Role, string> = { customer: "/", trainer: "/trainer", admin: "/admin" };
