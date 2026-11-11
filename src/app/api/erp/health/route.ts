import { NextResponse } from 'next/server';
import erp from '@/lib/erp';

export const dynamic = 'force-dynamic';

// Confirms DATABASE_URL (the ERP) is reachable.
export async function GET() {
  try {
    const [row] = await erp.$queryRaw<{ database: string; table_count: bigint }[]>`
      SELECT current_database() AS database,
             (SELECT count(*) FROM information_schema.tables
               WHERE table_schema NOT IN ('pg_catalog', 'information_schema')) AS table_count`;
    return NextResponse.json({ connected: true, database: row.database, tableCount: Number(row.table_count) });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n').pop() : 'Unknown error';
    return NextResponse.json({ connected: false, message }, { status: 503 });
  }
}
