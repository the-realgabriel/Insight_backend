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

    // Wiki tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS wiki_pages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        tags TEXT[] DEFAULT '{}',
        content TEXT NOT NULL DEFAULT '',
        user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wiki_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('file', 'dir')),
        content TEXT DEFAULT '',
        parent_path TEXT DEFAULT '',
        user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(path)
      );
    `);

    // Apply updated_at triggers to wiki tables
    await client.query(`
      DROP TRIGGER IF EXISTS set_updated_at_wiki_pages ON wiki_pages;
      CREATE TRIGGER set_updated_at_wiki_pages
        BEFORE UPDATE ON wiki_pages
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS set_updated_at_wiki_files ON wiki_files;
      CREATE TRIGGER set_updated_at_wiki_files
        BEFORE UPDATE ON wiki_files
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    // Apply realtime notify triggers to wiki tables
    await client.query(`
      DROP TRIGGER IF EXISTS notify_wiki_pages ON wiki_pages;
      CREATE TRIGGER notify_wiki_pages
        AFTER INSERT OR UPDATE OR DELETE ON wiki_pages
        FOR EACH ROW EXECUTE FUNCTION notify_table_change();
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS notify_wiki_files ON wiki_files;
      CREATE TRIGGER notify_wiki_files
        AFTER INSERT OR UPDATE OR DELETE ON wiki_files
        FOR EACH ROW EXECUTE FUNCTION notify_table_change();
    `);

    // Seed default wiki pages if empty
    const pageCount = await client.query(`SELECT COUNT(*) FROM wiki_pages`);
    if (parseInt(pageCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO wiki_pages (slug, title, tags, content) VALUES
        ('artificial-intelligence', 'Artificial Intelligence', ARRAY['AI', 'machine-learning', 'technology'], '## What is Artificial Intelligence?\n\nArtificial Intelligence (AI) refers to the simulation of human intelligence by machines programmed to think and learn.'),
        ('machine-learning', 'Machine Learning', ARRAY['AI', 'machine-learning', 'data-science'], '## What is Machine Learning?\n\nMachine Learning (ML) is a subset of artificial intelligence that enables systems to learn and improve from experience.'),
        ('getting-started', 'Getting Started with AI Wiki', ARRAY['wiki', 'guide', 'help'], '## Welcome to AI Wiki!\n\nThis wiki is powered by artificial intelligence to help you learn and explore topics more effectively.')
      `);
    }

    // Seed default files if empty
    const fileCount = await client.query(`SELECT COUNT(*) FROM wiki_files`);
    if (parseInt(fileCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO wiki_files (path, name, type, content, parent_path) VALUES
        ('README.md', 'README.md', 'file', '# Dataphyte WIKI\n\nAn AI-powered knowledge base.', ''),
        ('docs', 'docs', 'dir', '', ''),
        ('docs/getting-started.md', 'getting-started.md', 'file', '# Getting Started\n\nWelcome to Dataphyte WIKI!', 'docs'),
        ('docs/architecture.md', 'architecture.md', 'file', '# Architecture\n\n## Overview\n\nSingle-page application built with React and Vite.', 'docs'),
        ('guides', 'guides', 'dir', '', ''),
        ('guides/contributing.md', 'contributing.md', 'file', '# Contributing\n\nWe welcome contributions!', 'guides'),
        ('api', 'api', 'dir', '', ''),
        ('api/rest-api.md', 'rest-api.md', 'file', '# REST API\n\n## Endpoints', 'api')
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Database initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
