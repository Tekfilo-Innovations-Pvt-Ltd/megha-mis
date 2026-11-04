// Runs after `prisma db pull` on prisma/schema.prisma (see `npm run erp:pull`).
//
// Prisma field names can't start with "_" or a digit, so introspection strips
// both — columns like _24k_wt / _22k_wt / _18k_wt all become `k_wt` and the
// schema fails validation. Rename every such field after its real column
// (_24k_wt -> c24k_wt); the @map keeps the database column name unchanged.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../prisma/schema.prisma', import.meta.url);
const schema = readFileSync(file, 'utf8');

let renamed = 0;
const fixed = schema.replace(/^(\s+)(\w+)(\s+.*@map\("_+(\d\w*)"\))/gm, (_line, indent, _field, rest, column) => {
  renamed++;
  return `${indent}c${column}${rest}`;
});

writeFileSync(file, fixed);
console.log(`fix-erp-schema: renamed ${renamed} field(s) whose column starts with "_<digit>"`);
