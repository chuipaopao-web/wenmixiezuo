ALTER TABLE account_users
  ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 1 CHECK (profile_version > 0);

CREATE INDEX IF NOT EXISTS account_users_profile_version_idx
  ON account_users (user_id, profile_version);
