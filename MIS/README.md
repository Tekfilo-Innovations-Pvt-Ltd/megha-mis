# Megha MIS

> **Tech:** Next.js 14 (App Router) + Prisma + PostgreSQL + NextAuth.js + Tailwind CSS + React Query (same stack as megha-sales)

MIS reporting directly on the Megha ERP tenant database. There is **one database** — the ERP — and MIS only reads it.

- Schema: `prisma/schema.prisma` — introspected from the ERP, never hand-edited or migrated
- Client: `import erp from '@/lib/erp'` (writes throw; `erp.$queryRaw` for report SQL)
- Login: the ERP's own users (`tbl_user`, username or email) and passwords (PBKDF2, same as jew-trade-service). Roles come from `tbl_user_roles` → `tbl_roles`; `is_superadmin` = ADMIN in MIS.

Never run `prisma migrate` or `prisma db push` — jew-trade-service owns the ERP tables.

## Setup

```bash
nvm use 20.20.2
cp .env.example .env          # fill DATABASE_URL (ERP tenant DB) and NEXTAUTH_SECRET
npm install                    # also generates the ERP client
npm run dev                    # http://localhost:3001 — sign in with an ERP login
```

After ERP schema changes: `npm run erp:pull` (introspect + fix-up + generate). It is slow and memory-hungry (~900 tables).

Check the connection and the read-only guard: `npx tsx scripts/check-erp.ts`.

## Read-only database role (recommended)

Run once on the tenant database as an admin, then use `mis_readonly` in `DATABASE_URL`:

```sql
CREATE ROLE mis_readonly LOGIN PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE tenantb8278d TO mis_readonly;
GRANT USAGE ON SCHEMA public TO mis_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mis_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mis_readonly;
ALTER ROLE mis_readonly SET default_transaction_read_only = on;
```

## Factory price charts

Factory Price Chart → Metal Chart / Setting Chart show factory labour charts in MIS's own normalised structure (types in `src/lib/priceChart.ts`). They are not stored in the ERP and apply to every company. Rows are keyed on ERP master names — product type, commodity / commodity group, shape and **setting type** (Prong/Pave, Micro Pave, Channel, Bezel… are ERP setting types) — and matched against the selected company's masters on screen.

- **Storage:** one JSON file per chart in `data/price-charts/` (or `$PRICE_CHART_DIR`), read on every request. In Docker this folder is the `price-charts` volume.
- **Download** (any user): the chart as an `.xlsx` workbook, one sheet per table.
- **Upload** (ADMIN only): deletes the chart's data and replaces it with the workbook. The whole file is validated first — on any problem nothing changes and the problems are listed by sheet and row. The previous chart is kept in `data/price-charts/backups/<code>.<yyyymmdd-hhmmss>.json`; to roll back, copy a backup over `<code>.json`.
- **First import from the factory's original Excel** (W8 & W8-1 layout only; stops with "Layout changed" if a header cell moved):

```bash
node scripts/import-labor-chart.mjs "<chart>.xls" <chart-code>   # e.g. w8-gold-2018-12-01
```

## Adding a report

1. `src/app/api/reports/<name>/route.ts`: `requirePermission(...)`, then query with `erp`.
2. `src/app/dashboard/<name>/page.tsx`: fetch with React Query, chart with Recharts.
3. Add it to `NAV_ITEMS` in `src/app/dashboard/layout.tsx`.

## Docker

`docker compose up -d --build` — a single app container; no migrations run on start.
