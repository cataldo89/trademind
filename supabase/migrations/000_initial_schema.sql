-- ============================================================
-- TradeMind - Supabase Database Schema
-- Aplicable desde cero por Supabase CLI/migrations.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

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

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  entry_price NUMERIC NOT NULL CHECK (entry_price > 0),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes TEXT,
  exit_price NUMERIC,
  realized_pnl NUMERIC,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_price NUMERIC;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC;

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price NUMERIC NOT NULL CHECK (price > 0),
  total NUMERIC GENERATED ALWAYS AS (quantity * price) STORED,
  commission NUMERIC DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON transactions(symbol);

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

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can manage own watchlist" ON watchlist_items;
CREATE POLICY "Users can manage own watchlist" ON watchlist_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own positions" ON positions;
CREATE POLICY "Users can manage own positions" ON positions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own transactions" ON transactions;
CREATE POLICY "Users can manage own transactions" ON transactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own alerts" ON alerts;
CREATE POLICY "Users can manage own alerts" ON alerts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own signals" ON signals;
CREATE POLICY "Users can manage own signals" ON signals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS service_insert_audit ON audit_logs;
CREATE POLICY service_insert_audit ON audit_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS users_view_audit ON audit_logs;
CREATE POLICY users_view_audit ON audit_logs FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION execute_virtual_trade(
  p_user_id UUID,
  p_symbol TEXT,
  p_name TEXT,
  p_market TEXT,
  p_amount NUMERIC,
  p_quantity NUMERIC,
  p_price NUMERIC,
  p_source TEXT DEFAULT 'manual',
  p_signal_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_balance NUMERIC;
  v_quantity NUMERIC;
  v_total NUMERIC;
  v_position_id UUID;
  v_transaction_id UUID;
  v_signal_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF p_market NOT IN ('US', 'CL') THEN
    RAISE EXCEPTION 'INVALID_MARKET' USING ERRCODE = 'P0001';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'INVALID_PRICE' USING ERRCODE = 'P0001';
  END IF;

  v_quantity := COALESCE(p_quantity, ROUND(p_amount / p_price, 8));
  v_total := COALESCE(p_amount, v_quantity * p_price);

  IF v_quantity IS NULL OR v_quantity <= 0 OR v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'INVALID_ORDER_SIZE' USING ERRCODE = 'P0001';
  END IF;

  SELECT virtual_balance INTO v_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_balance < v_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001';
  END IF;

  IF p_signal_id IS NOT NULL THEN
    UPDATE signals
    SET status = 'cancelled'
    WHERE id = p_signal_id
      AND user_id = p_user_id
      AND status = 'active'
    RETURNING id INTO v_signal_id;

    IF v_signal_id IS NULL THEN
      RAISE EXCEPTION 'SIGNAL_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO positions (user_id, symbol, name, market, quantity, entry_price, entry_date, currency, notes, status)
  VALUES (p_user_id, UPPER(p_symbol), COALESCE(p_name, UPPER(p_symbol)), p_market, v_quantity, p_price, CURRENT_DATE, 'USD', p_notes, 'open')
  RETURNING id INTO v_position_id;

  UPDATE profiles
  SET virtual_balance = virtual_balance - v_total,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING virtual_balance INTO v_balance;

  INSERT INTO transactions (user_id, symbol, name, market, type, quantity, price, currency, notes)
  VALUES (p_user_id, UPPER(p_symbol), COALESCE(p_name, UPPER(p_symbol)), p_market, 'BUY', v_quantity, p_price, 'USD', p_notes)
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'position', jsonb_build_object('id', v_position_id, 'symbol', UPPER(p_symbol), 'market', p_market, 'quantity', v_quantity, 'entryPrice', p_price, 'status', 'open'),
    'transaction', jsonb_build_object('id', v_transaction_id, 'type', 'BUY', 'quantity', v_quantity, 'price', p_price, 'total', v_total),
    'profile', jsonb_build_object('virtualBalance', v_balance),
    'signal', CASE WHEN v_signal_id IS NULL THEN NULL ELSE jsonb_build_object('id', v_signal_id, 'status', 'cancelled') END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION close_virtual_position(
  p_user_id UUID,
  p_position_id UUID,
  p_price NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_position positions%ROWTYPE;
  v_balance NUMERIC;
  v_proceeds NUMERIC;
  v_realized_pnl NUMERIC;
  v_transaction_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'INVALID_PRICE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_position
  FROM positions
  WHERE id = p_position_id
    AND user_id = p_user_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'POSITION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT virtual_balance INTO v_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_proceeds := v_position.quantity * p_price;
  v_realized_pnl := v_proceeds - (v_position.quantity * v_position.entry_price);

  UPDATE positions
  SET status = 'closed',
      closed_at = NOW(),
      exit_price = p_price,
      realized_pnl = v_realized_pnl,
      updated_at = NOW()
  WHERE id = p_position_id;

  UPDATE profiles
  SET virtual_balance = virtual_balance + v_proceeds,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING virtual_balance INTO v_balance;

  INSERT INTO transactions (user_id, symbol, name, market, type, quantity, price, currency, notes)
  VALUES (p_user_id, v_position.symbol, v_position.name, v_position.market, 'SELL', v_position.quantity, p_price, v_position.currency, p_notes)
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'position', jsonb_build_object('id', p_position_id, 'symbol', v_position.symbol, 'status', 'closed', 'closedAt', NOW()),
    'transaction', jsonb_build_object('id', v_transaction_id, 'type', 'SELL', 'quantity', v_position.quantity, 'price', p_price, 'total', v_proceeds),
    'profile', jsonb_build_object('virtualBalance', v_balance),
    'realizedPnl', v_realized_pnl
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION execute_virtual_trade(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION close_virtual_position(UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- bumped: 2026-05-10T14:56:41-04:00