ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'savings',
  ADD COLUMN IF NOT EXISTS ifsc_code CHAR(11) NOT NULL DEFAULT 'XXXXXXXXXXX',
  ADD COLUMN IF NOT EXISTS mobile_number CHAR(10) NOT NULL DEFAULT '0000000000';

ALTER TABLE bank_accounts
  DROP CONSTRAINT IF EXISTS bank_accounts_account_type_check;

ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_account_type_check
  CHECK (account_type IN ('savings','current','corporate'));
