import { PrismaClient } from '@/generated/erp';

// Read-only client for the ERP database (prisma/schema.prisma) — the only
// database MIS uses. The real guarantee is a read-only Postgres role in
// DATABASE_URL (see README); this extension is a second layer so a stray
// create/update in MIS code fails loudly instead of touching ERP data.

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  '$executeRaw',
  '$executeRawUnsafe',
]);

function createErpClient() {
  const base = new PrismaClient(
    process.env.DATABASE_URL
      ? undefined
      : { datasources: { db: { url: 'postgresql://tenantb8278d:TekFilo%232021@13.127.119.227:5432/devmegha' } } }
  );
  return base.$extends({
    query: {
      $allOperations({ operation, model, args, query }) {
        if (WRITE_OPERATIONS.has(operation)) {
          throw new Error(`ERP database is read-only — blocked ${model ?? ''}.${operation}`);
        }
        return query(args);
      },
    },
  });
}

type ErpClient = ReturnType<typeof createErpClient>;

declare global {
  // eslint-disable-next-line no-var
  var erp: ErpClient | undefined;
}

const erp = global.erp || createErpClient();

if (process.env.NODE_ENV !== 'production') global.erp = erp;

export default erp;
