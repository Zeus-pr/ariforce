-- Doctor email. date_of_birth and anniversary already exist (0001). Nullable, additive.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS doctors_email_idx ON doctors (company_id, lower(email));
