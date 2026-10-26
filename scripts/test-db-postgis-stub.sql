-- Test-only PostGIS stand-in: geometry is a text domain. Point values written by drizzle as
-- 'point(x y)' are converted to EWKB hex (SRID 4326) so drizzle can parse them on read.
CREATE OR REPLACE FUNCTION _le8(x float8) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(lpad(to_hex(get_byte(float8send(x), 7 - i)), 2, '0'), '' ORDER BY i)
  FROM generate_series(0, 7) i $$;
CREATE OR REPLACE FUNCTION _pt_ewkb(v text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[];
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  m := regexp_match(v, '^\s*(?:SRID=\d+;)?point\s*\(\s*([-0-9.eE]+)\s+([-0-9.eE]+)\s*\)\s*$', 'i');
  IF m IS NULL THEN RETURN v; END IF;
  RETURN '0101000020E6100000' || _le8(m[1]::float8) || _le8(m[2]::float8);
END $$;
CREATE OR REPLACE FUNCTION _geom_stub_trg() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jsonb := to_jsonb(NEW); c text;
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    j := jsonb_set(j, ARRAY[c], to_jsonb(_pt_ewkb(j->>c)));
  END LOOP;
  NEW := jsonb_populate_record(NEW, j);
  RETURN NEW;
END $$;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name, array_agg(quote_literal(column_name)) cols FROM information_schema.columns
    WHERE table_schema = 'public' AND domain_name = 'geometry' AND column_name <> 'boundary'
    GROUP BY table_name LOOP
    EXECUTE format('CREATE TRIGGER _geom_stub BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION _geom_stub_trg(%s)',
      r.table_name, array_to_string(r.cols, ','));
  END LOOP;
END $$;
