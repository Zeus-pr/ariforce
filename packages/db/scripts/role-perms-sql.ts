import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLE_PERMISSIONS_MIGRATION, rolePermissionsSql } from '../src/role-permissions-sql';

const file = fileURLToPath(
  new URL(`../drizzle/${ROLE_PERMISSIONS_MIGRATION}.sql`, import.meta.url),
);
const want = rolePermissionsSql();
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== want) {
    console.error(`${file} is out of date with DEFAULT_ROLE_PERMISSIONS; run db:role-perms`);
    process.exit(1);
  }
  console.log('role permissions SQL up to date');
} else {
  writeFileSync(file, want);
  console.log(`wrote ${file}`);
}
