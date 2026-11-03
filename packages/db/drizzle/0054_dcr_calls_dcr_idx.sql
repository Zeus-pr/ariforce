-- dcr_calls lookups by parent DCR (toDto, call replace on save, DCR delete) had no index and
-- seq-scanned the company's calls. Additive; re-runnable.
-- Plain CREATE INDEX (not CONCURRENTLY): every migration runs inside a transaction
-- (scripts/sql-files.ts), where CONCURRENTLY is not allowed, same as all earlier index migrations.
-- It holds a SHARE lock on dcr_calls (blocks writes, not reads) for the build; apply off-peak.
CREATE INDEX IF NOT EXISTS dcr_calls_dcr_idx ON dcr_calls USING btree (company_id, dcr_id);
