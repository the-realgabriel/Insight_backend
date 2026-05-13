import { pool } from './pool.js';

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Core auth tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Example user data table — this mimics Supabase's "public" schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        username TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Trigger function for updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Apply updated_at trigger to auth_users
    await client.query(`
      DROP TRIGGER IF EXISTS set_updated_at_auth_users ON auth_users;
      CREATE TRIGGER set_updated_at_auth_users
        BEFORE UPDATE ON auth_users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    // Notify trigger for realtime: fires pg_notify on INSERT/UPDATE/DELETE
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_table_change()
      RETURNS TRIGGER AS $$
      DECLARE
        payload JSON;
        record_data JSON;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          record_data = row_to_json(OLD);
        ELSE
          record_data = row_to_json(NEW);
        END IF;

        payload = json_build_object(
          'table', TG_TABLE_NAME,
          'action', TG_OP,
          'data', record_data,
          'timestamp', NOW()
        );

        PERFORM pg_notify('table_changes', payload::text);
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Apply realtime notify trigger to user_profiles
    await client.query(`
      DROP TRIGGER IF EXISTS notify_user_profiles ON user_profiles;
      CREATE TRIGGER notify_user_profiles
        AFTER INSERT OR UPDATE OR DELETE ON user_profiles
        FOR EACH ROW EXECUTE FUNCTION notify_table_change();
    `);

    await client.query('COMMIT');
    console.log('✅ Database initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
