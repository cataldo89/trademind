/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * patch-trigger.js — Script de mantenimiento de DB
 * USO: DATABASE_URL="postgresql://..." node patch-trigger.js
 * NO ejecutar en producción directamente. Usar Supabase Dashboard → SQL Editor.
 */
const { Client } = require('pg');

async function patchDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('ERROR: Define la variable de entorno DATABASE_URL antes de ejecutar.');
    console.error('Ejemplo: DATABASE_URL="postgresql://postgres:<password>@<host>:6543/postgres" node patch-trigger.js');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL...');

    const sql = `
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS trigger AS $$
      BEGIN
        INSERT INTO public.profiles (id, email, full_name, avatar_url)
        VALUES (
          new.id,
          new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'avatar_url'
        );
        RETURN new;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `;

    await client.query(sql);
    console.log('Trigger function handle_new_user patched successfully!');
  } catch (error) {
    console.error('Error patching DB:', error);
  } finally {
    await client.end();
  }
}

patchDatabase();

# bumped: 2026-05-05T04:21:00