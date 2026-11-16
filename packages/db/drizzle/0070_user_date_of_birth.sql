-- Employee birthday. Nullable. The daily occasion job reminds the direct manager.
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth date;
