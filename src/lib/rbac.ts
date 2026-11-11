import { Session } from 'next-auth';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';

export function checkPermission(session: Session | null, permission: string): boolean {
  if (!session) return false;
  return hasPermission(session.user.roles || [], session.user.permissions || [], permission);
}

// Usage in a route handler:
//   const denied = await requirePermission('view_sales_reports');
//   if (denied) return denied;
export async function requirePermission(permission: string): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  if (checkPermission(session, permission)) {
    return null;
  }
  return NextResponse.json({ message: `Forbidden — requires the "${permission}" permission` }, { status: 403 });
}
