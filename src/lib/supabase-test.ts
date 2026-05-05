// src/lib/supabase-test.ts
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env.local
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log("1. Insertando registro en signals...");
  
  const dummySignal = {
    user_id: "00000000-0000-0000-0000-000000000000", // Fallback or assume RLS allows Service Role
    symbol: "TEST",
    market: "US",
    type: "BUY",
    strength: 80,
    timeframe: "1D",
    status: "active"
  };

  const { data: insertData, error: insertError } = await supabase
    .from('signals')
    .insert(dummySignal)
    .select()
    .single();

  if (insertError) {
    console.error("❌ Error insertando signal:", insertError.message);
  } else {
    console.log("✅ Insert exitoso. ID:", insertData.id);
    
    console.log("2. Recuperando registro...");
    const { data: readData, error: readError } = await supabase
      .from('signals')
      .select('*')
      .eq('id', insertData.id)
      .single();
      
    if (readError) {
      console.error("❌ Error recuperando signal:", readError.message);
    } else {
      console.log("✅ Recuperación exitosa:", readData.symbol);
    }
    
    // Cleanup
    await supabase.from('signals').delete().eq('id', insertData.id);
    console.log("✅ Cleanup exitoso.");
  }
}

runTest();

# bumped: 2026-05-05T04:21:00