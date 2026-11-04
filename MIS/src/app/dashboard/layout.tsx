'use client';

import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  HomeIcon,
  ArrowRightOnRectangleIcon,
  DocumentTextIcon,
  TableCellsIcon,
  ChartBarIcon,
  SparklesIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { usePermissions } from '@/hooks/usePermissions';
import CompanySwitcher from '@/components/CompanySwitcher';

interface NavChild {
  href: string;
  label: string;
  permission?: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  children?: NavChild[]; // a group: `href` is only its path prefix
}

// Add MIS report pages here as they're built; `permission` hides the entry
// for users whose roles don't grant it (ADMIN sees everything).
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { href: '/dashboard/factory-invoices', label: 'Factory Invoices', icon: DocumentTextIcon },
  {
    href: '/dashboard/price-charts',
    label: 'Factory Price Chart',
    icon: TableCellsIcon,
    children: [
      { href: '/dashboard/price-charts/metal', label: 'Metal Chart' },
      { href: '/dashboard/price-charts/setting', label: 'Setting Chart' },
    ],
  },
  {
    href: '/dashboard/reports',
    label: 'Reports',
    icon: ChartBarIcon,
    children: [{ href: '/dashboard/reports/labour-vs-chart', label: 'Labour vs Chart' }],
  },
  { href: '/dashboard/ask', label: 'Ask MIS', icon: SparklesIcon, permission: 'use_ask_mis' },
  { href: '/dashboard/settings/ai', label: 'AI Settings', icon: Cog6ToothIcon, permission: 'manage_ai_settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { has } = usePermissions();
  const allowed = (p?: string) => !p || has(p);
  const isActive = (href: string) => (href === '/dashboard' ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-200 flex flex-col">
        <div className="px-5 py-5 text-lg font-bold text-white">Megha MIS</div>
        <CompanySwitcher />
        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.filter((item) => allowed(item.permission)).map((item) => {
            if (item.children) {
              const visible = item.children.filter((c) => allowed(c.permission));
              if (visible.length === 0) return null;
              return (
                <div key={item.href} className="pt-1">
                  <div className={`flex items-center gap-3 px-3 py-2 text-sm ${isActive(item.href) ? 'text-white' : 'text-slate-300'}`}>
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </div>
                  <div className="ml-5 pl-3 border-l border-slate-700 space-y-1">
                    {visible.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`block px-3 py-1.5 rounded-lg text-sm ${isActive(child.href) ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${isActive(item.href) ? 'bg-amber-600 text-white' : 'hover:bg-slate-800'}`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-800 text-sm">
          <div className="truncate text-slate-400">{session?.user?.name}</div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="mt-2 flex items-center gap-2 text-slate-300 hover:text-white"
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-x-auto">{children}</main>
    </div>
  );
}
