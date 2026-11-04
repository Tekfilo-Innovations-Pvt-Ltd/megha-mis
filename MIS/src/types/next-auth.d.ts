import { DefaultSession, DefaultUser } from 'next-auth';
import { DefaultJWT } from 'next-auth/jwt';

interface CompanyOption {
  id: number;
  name: string;
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      roles: string[];
      permissions: string[];
      companies: CompanyOption[]; // companies this user may switch between
      companyId: number | null; // company currently selected
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    id: string;
    roles: string[];
    permissions: string[];
    companies: CompanyOption[];
    companyId: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string;
    roles: string[];
    permissions: string[];
    companies?: CompanyOption[]; // undefined on sessions from before company switching
    companyId?: number;
  }
}
