// Smoke test for the ERP client: one read, and one write that the read-only
// guard in src/lib/erp.ts must block before it reaches the database.
//   npx tsx scripts/check-erp.ts
import 'dotenv/config';
import erp from '../src/lib/erp';

async function main() {
  const migrations = await erp.flyway_schema_history.count();
  console.log(`read ok — flyway_schema_history has ${migrations} rows`);

  try {
    await erp.flyway_schema_history.deleteMany({ where: { installed_rank: -1 } });
    console.log('WRITE WAS NOT BLOCKED');
    process.exitCode = 1;
  } catch (e) {
    console.log(`write blocked — ${(e as Error).message}`);
  }
}

main().finally(() => erp.$disconnect());
