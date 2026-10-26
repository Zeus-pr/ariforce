-- Lead already applied this by hand on the real DB (tracked there as 0010a_users_joined_on); IF NOT EXISTS keeps it a no-op.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "joined_on" date;
