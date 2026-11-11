// Pure boolean RBAC logic — no server-only imports, so it's safe to import
// from client components too. src/lib/rbac.ts wraps this for route guards;
// src/hooks/usePermissions.ts wraps it for client-side UI gating.

export function hasPermission(roles: string[], permissions: string[], required: string): boolean {
  return roles.includes('ADMIN') || permissions.includes(required);
}

export function hasAnyPermission(roles: string[], permissions: string[], required: string[]): boolean {
  return required.some((p) => hasPermission(roles, permissions, p));
}
