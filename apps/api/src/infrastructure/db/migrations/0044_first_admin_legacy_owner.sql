-- The first registered administrator is the owner of the pre-account local workspace.
-- Rebind the account instead of copying or rewriting any creative data.
UPDATE user_accounts AS account
SET owner_id = 'owner-local-boss',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE account.role = 'admin'
  AND account.status = 'active'
  AND account.owner_id <> 'owner-local-boss'
  AND (SELECT COUNT(*) FROM user_accounts) = 1
  AND EXISTS (
    SELECT 1 FROM owners legacy WHERE legacy.owner_id = 'owner-local-boss'
  )
  AND EXISTS (
    SELECT 1 FROM books legacy_book
    WHERE legacy_book.owner_id = 'owner-local-boss'
      AND legacy_book.status <> 'purged'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_accounts claimed
    WHERE claimed.owner_id = 'owner-local-boss'
  )
  AND NOT EXISTS (
    SELECT 1 FROM books current_book
    WHERE current_book.owner_id = account.owner_id
  );
