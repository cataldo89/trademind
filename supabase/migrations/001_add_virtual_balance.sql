-- ============================================================
-- Migration: Add virtual_balance column to profiles
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS virtual_balance NUMERIC NOT NULL DEFAULT 10000.0;

UPDATE profiles SET virtual_balance = 10000.0 WHERE virtual_balance IS NULL;
