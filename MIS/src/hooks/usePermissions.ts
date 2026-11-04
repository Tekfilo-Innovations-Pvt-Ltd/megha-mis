'use client';

import { useSession } from 'next-auth/react';
import { hasPermission, hasAnyPermission } from '@/lib/permissions';

// Single client-side source of truth for "can this user see/do X" — used by
// the dashboard nav filter and by individual pages (Users, Roles) to hide
// Add/Edit/Delete controls a viewer isn't allowed to use, not just to hide
// the nav link to the page itself.
export function usePermissions() {
  const { data: session } = useSession();
  const roles = session?.user?.roles || [];
  const permissions = session?.user?.permissions || [];

  return {
    roles,
    permissions,
    has: (permission: string) => hasPermission(roles, permissions, permission),
    hasAny: (required: string[]) => hasAnyPermission(roles, permissions, required),
  };
}
