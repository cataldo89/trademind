/**
 * create-user.mjs — Script de utilidad para crear usuarios de prueba
 * USO: SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." node create-user.mjs
 * NUNCA ejecutar en producción con usuarios reales.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: Define las variables de entorno:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL o SUPABASE_URL');
  console.error('  SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function run() {
  const testEmail = process.env.TEST_USER_EMAIL || 'testagent99@example.com';
  const testPassword = process.env.TEST_USER_PASSWORD || 'changeme123!';

  const { data, error } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });
  if (error) console.error('Error:', error.message);
  else console.log('Created user:', data.user?.email);
}

run();
