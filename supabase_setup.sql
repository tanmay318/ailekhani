-- ═══════════════════════════════════════════════════════════
-- AI Lekhani — Fresh Database Setup
-- Run on a BRAND NEW Supabase project only.
-- Supabase → SQL Editor → New query → paste all → Run
-- Expected result: 5 rows showing table names and 0 counts
-- (visitor_counts shows 1 because we seed it below)
-- ═══════════════════════════════════════════════════════════

-- ── TABLE 1: users ─────────────────────────────────────────
-- One row per person.
-- UUID is the permanent identity — never changes.
-- Email is NOT stored here. It lives in auth_providers only.
-- This means if a user loses their Gmail, you can link a new
-- one without touching this table at all.

CREATE TABLE users (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  display_name          TEXT,
  country               TEXT NOT NULL DEFAULT 'Unknown',
  plan                  TEXT NOT NULL DEFAULT 'free',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  licence_key           TEXT,
  upgrade_viewed_at     TIMESTAMPTZ,
  payment_started_at    TIMESTAMPTZ,
  payment_failed_at     TIMESTAMPTZ,
  payment_failed_reason TEXT,
  last_import_at        TIMESTAMPTZ
);

CREATE INDEX users_plan_idx ON users(plan);

-- ── TABLE 2: auth_providers ────────────────────────────────
-- Maps login methods to user UUIDs.
-- One user can have many rows here (Google AND Apple etc).
-- provider       = 'google', 'apple', 'email'
-- provider_email = the email address from that provider
-- UNIQUE(provider, provider_email) means the same Google
-- account can never be linked to two different users.

CREATE TABLE auth_providers (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  provider_email TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_email)
);

CREATE INDEX auth_provider_lookup ON auth_providers(provider, provider_email);
CREATE INDEX auth_user_idx        ON auth_providers(user_id);

-- ── TABLE 3: visitor_counts ────────────────────────────────
-- Single row that counts all landing page visits.
-- Shown publicly on the landing page counter.

CREATE TABLE visitor_counts (
  id           INT PRIMARY KEY DEFAULT 1,
  total_visits BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the single row
INSERT INTO visitor_counts (id, total_visits) VALUES (1, 0);

-- ── TABLE 4: licences ──────────────────────────────────────
-- One row per payment. References users.id (UUID).
-- When a user pays, a row is inserted here and their plan
-- column in the users table is updated to 'pro'.

CREATE TABLE licences (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  licence_key TEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'monthly',
  payment_id  TEXT,
  order_id    TEXT,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX licences_user_idx ON licences(user_id);

-- ── TABLE 5: waitlist ──────────────────────────────────────
-- Emails of free users who clicked "Join Pro Waitlist".
-- When you launch payments, email everyone in this table.
-- converted = true once they become a paying Pro user.

CREATE TABLE waitlist (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT NOT NULL DEFAULT 'app',
  converted    BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── FUNCTION: increment_visitors ───────────────────────────
-- Called by the Netlify auth function on every landing page load.
-- Increments the single row in visitor_counts by 1.

CREATE FUNCTION increment_visitors()
RETURNS void AS $$
  UPDATE visitor_counts
  SET total_visits = total_visits + 1,
      updated_at   = NOW()
  WHERE id = 1;
$$ LANGUAGE sql;

-- ── FUNCTION: link_new_email ───────────────────────────────
-- Use this when a user loses their Gmail and needs to connect
-- a new email address to their existing account.
--
-- How to use (run in SQL Editor):
--   SELECT link_new_email('lost@gmail.com', 'new@gmail.com');
--
-- What it does: finds the user who previously logged in with
-- lost@gmail.com, then adds new@gmail.com as an additional
-- login method for that same account. The user logs in with
-- their new Gmail and arrives at exactly the same account —
-- same plan, same history, nothing lost.

CREATE FUNCTION link_new_email(old_email TEXT, new_email TEXT)
RETURNS TEXT AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM   auth_providers
  WHERE  provider = 'google'
  AND    provider_email = old_email
  LIMIT  1;

  IF v_user_id IS NULL THEN
    RETURN 'ERROR: no account found for ' || old_email;
  END IF;

  INSERT INTO auth_providers (user_id, provider, provider_email)
  VALUES (v_user_id, 'google', new_email)
  ON CONFLICT (provider, provider_email) DO NOTHING;

  RETURN 'DONE: ' || new_email || ' now links to the same account as ' || old_email;
END;
$$ LANGUAGE plpgsql;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────
-- Enables RLS on all tables.
-- Service role key (used by Netlify functions) bypasses RLS.
-- Anon key gets zero access to anything except visitor count.

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE licences       ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist       ENABLE ROW LEVEL SECURITY;

-- Public can read visitor count (landing page counter)
CREATE POLICY "public_read_visitors"
  ON visitor_counts FOR SELECT
  USING (true);

-- Everything else: no public access at all
CREATE POLICY "no_public_users"
  ON users FOR SELECT USING (false);

CREATE POLICY "no_public_auth_providers"
  ON auth_providers FOR SELECT USING (false);

CREATE POLICY "no_public_licences"
  ON licences FOR SELECT USING (false);

CREATE POLICY "no_public_waitlist"
  ON waitlist FOR SELECT USING (false);

-- ── VERIFY ─────────────────────────────────────────────────
-- You should see exactly this after running:
--
--   table_name     | rows
--   ───────────────────────
--   users          |    0
--   auth_providers |    0
--   visitor_counts |    1   ← seeded above
--   licences       |    0
--   waitlist       |    0

SELECT 'users'          AS table_name, COUNT(*) AS rows FROM users
UNION ALL
SELECT 'auth_providers',               COUNT(*)          FROM auth_providers
UNION ALL
SELECT 'visitor_counts',               COUNT(*)          FROM visitor_counts
UNION ALL
SELECT 'licences',                     COUNT(*)          FROM licences
UNION ALL
SELECT 'waitlist',                     COUNT(*)          FROM waitlist;
