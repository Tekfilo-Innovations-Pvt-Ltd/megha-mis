// MIS's own session cookie name: browsers don't scope cookies by port, so on
// localhost the default next-auth.session-token would collide with megha-sales
// (port 3000). Kept apart from auth.ts so the Edge middleware can import it
// without pulling in Prisma.
export const SESSION_COOKIE = 'mis.session-token';
