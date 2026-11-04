import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import erp from '@/lib/erp';
import { verifyErpPassword } from '@/lib/erpPassword';
import { SESSION_COOKIE } from '@/lib/sessionCookie';
import { getUserCompanies } from '@/lib/company';

// Signs in against the ERP's own users (tbl_user), with the ERP's password
// hashing. MIS is read-only, so nothing is written back (no login count /
// last-login update).
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username or email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error('Username and password required');
        }

        const login = credentials.username.trim();
        const user = await erp.tbl_user.findFirst({
          where: {
            OR: [{ username: login }, { email: { equals: login, mode: 'insensitive' } }],
            is_deleted: 0,
          },
          include: {
            tbl_user_roles: {
              where: { is_deleted: 0, tbl_roles: { is_deleted: 0 } },
              include: { tbl_roles: true },
            },
          },
        });

        if (!user || user.is_active !== 1 || user.is_locked === 1) {
          throw new Error('Invalid credentials');
        }

        if (!verifyErpPassword(credentials.password, user.password)) {
          throw new Error('Invalid credentials');
        }

        // ERP superadmins get MIS's ADMIN bypass (src/lib/permissions.ts).
        const roles = Array.from(new Set(user.tbl_user_roles.map((ur) => ur.tbl_roles.role_name)));
        if (user.is_superadmin === 1) roles.push('ADMIN');

        // All ERP data is company-wise — a user with no company can't see anything.
        const companies = await getUserCompanies(user.user_id, user.is_superadmin === 1);
        if (companies.length === 0) {
          throw new Error('No company access');
        }

        return {
          companies,
          companyId: companies[0].id,
          id: String(user.user_id),
          email: user.email,
          name: [user.first_name, user.last_name].filter(Boolean).join(' '),
          roles,
          // ERP permissions are menu/action grants (tbl_role_permission) — not
          // loaded into the token yet; MIS pages gate on roles for now.
          permissions: [],
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' },
    },
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.roles = user.roles;
        token.permissions = user.permissions;
        token.companies = user.companies;
        token.companyId = user.companyId;
      }
      // Company switch from the sidebar (useSession().update({ companyId })) —
      // only to a company this user was granted at sign-in.
      if (trigger === 'update' && session?.companyId != null) {
        const companyId = Number(session.companyId);
        if (token.companies?.some((c) => c.id === companyId)) {
          token.companyId = companyId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.roles = token.roles;
        session.user.permissions = token.permissions;
        session.user.companies = token.companies ?? [];
        session.user.companyId = token.companyId ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
