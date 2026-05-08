-- ============================================================
-- TradeMind — Supabase Database Schema
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES (extiende auth.users de Supabase)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  virtual_balance NUMERIC NOT NULL DEFAULT 10000.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- WATCHLIST ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS watchlist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user_id ON watchlist_items(user_id);

-- ============================================================
-- POSITIONS (portafolio)
-- ============================================================
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  quantity NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);

-- ============================================================
-- TRANSACTIONS (historial de operaciones)
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  quantity NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * price) STORED,
  commission NUMERIC DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON transactions(symbol);

-- ============================================================
-- ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  condition TEXT NOT NULL CHECK (condition IN (
    'price_above', 'price_below',
    'change_percent_above', 'change_percent_below',
    'volume_above',
    'rsi_above', 'rsi_below',
    'ma_crossover_bull', 'ma_crossover_bear'
  )),
  value NUMERIC NOT NULL,
  current_value NUMERIC,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'expired', 'paused')),
  notify_email BOOLEAN NOT NULL DEFAULT FALSE,
  notify_app BOOLEAN NOT NULL DEFAULT TRUE,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

-- ============================================================
-- SIGNALS (señales IA generadas)
-- ============================================================
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'HOLD')),
  strength NUMERIC NOT NULL DEFAULT 50 CHECK (strength >= 0 AND strength <= 100),
  reason TEXT,
  price NUMERIC,
  target_price NUMERIC,
  stop_loss NUMERIC,
  timeframe TEXT NOT NULL DEFAULT '1d',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signals_user_id ON signals(user_id);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Seguridad por usuario
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

-- Profiles: user can only read/update their own
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Watchlist: user can CRUD their own items
CREATE POLICY "Users can manage own watchlist" ON watchlist_items
  FOR ALL USING (auth.uid() = user_id);

-- Positions
CREATE POLICY "Users can manage own positions" ON positions
  FOR ALL USING (auth.uid() = user_id);

-- Transactions
CREATE POLICY "Users can manage own transactions" ON transactions
  FOR ALL USING (auth.uid() = user_id);

-- Alerts
CREATE POLICY "Users can manage own alerts" ON alerts
  FOR ALL USING (auth.uid() = user_id);

-- Signals
CREATE POLICY "Users can manage own signals" ON signals
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- Auth callback helper (creates redirect URL automatically)
-- ============================================================
-- No additional SQL needed — handled by Supabase Auth callbacks

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details JSONB, ip_address TEXT, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_insert_audit ON audit_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY users_view_audit ON audit_logs FOR SELECT USING (auth.uid() = user_id);
# bumped: 2026-05-05T04:21:00