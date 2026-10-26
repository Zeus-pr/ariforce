import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? 'postgres://postgres:postgres@localhost:5432/ariforce',
  },
  extensionsFilters: ['postgis'],
});
