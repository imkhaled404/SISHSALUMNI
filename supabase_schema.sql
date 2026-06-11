-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/iwevvgvsdxurotzsibvr/sql/new)

CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS navigation (id SERIAL PRIMARY KEY, label TEXT NOT NULL, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS top_links (id SERIAL PRIMARY KEY, label TEXT NOT NULL, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hero_slides (id SERIAL PRIMARY KEY, image TEXT NOT NULL, eyebrow TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pages (id SERIAL PRIMARY KEY, page_key TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, image TEXT, render TEXT NOT NULL, download_label TEXT, download_url TEXT, filter TEXT, body_json TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS members (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, batch TEXT, type TEXT, image TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS committee (id SERIAL PRIMARY KEY, member_id INTEGER REFERENCES members(id) ON DELETE SET NULL, role TEXT NOT NULL, year TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Executive Committee', status TEXT NOT NULL DEFAULT 'active', designation_order INTEGER NOT NULL DEFAULT 9999, passing_year TEXT, biography TEXT, message TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, slug TEXT, path TEXT, type TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL, body_json TEXT NOT NULL, image TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS gallery (id SERIAL PRIMARY KEY, image TEXT NOT NULL, title TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS applications (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, batch TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'new', payload_json TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', payload_json TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, permissions_json TEXT, is_admin INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0, member_id INTEGER REFERENCES members(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS forum_posts (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_name TEXT, title TEXT NOT NULL, category TEXT, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS forum_comments (id SERIAL PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_name TEXT, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS forum_likes (post_id INTEGER NOT NULL, user_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (post_id, user_id));

-- Add unique constraint for users if not present
-- ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);

-- For existing projects created with an older version of this file.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE committee ADD COLUMN IF NOT EXISTS member_id INTEGER;
ALTER TABLE committee ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'Executive Committee';
ALTER TABLE committee ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE committee ADD COLUMN IF NOT EXISTS designation_order INTEGER NOT NULL DEFAULT 9999;
ALTER TABLE committee DROP COLUMN IF EXISTS name;
ALTER TABLE committee DROP COLUMN IF EXISTS email;
ALTER TABLE committee DROP COLUMN IF EXISTS phone;
ALTER TABLE committee DROP COLUMN IF EXISTS image;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
ALTER TABLE forum_posts ALTER COLUMN author_name DROP NOT NULL;
ALTER TABLE forum_comments ALTER COLUMN author_name DROP NOT NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS payload_json TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS payload_json TEXT;

CREATE INDEX IF NOT EXISTS committee_member_id_idx ON committee(member_id);
CREATE INDEX IF NOT EXISTS users_member_id_idx ON users(member_id);
CREATE INDEX IF NOT EXISTS forum_posts_user_id_idx ON forum_posts(user_id);
CREATE INDEX IF NOT EXISTS forum_comments_post_id_idx ON forum_comments(post_id);
CREATE INDEX IF NOT EXISTS forum_comments_user_id_idx ON forum_comments(user_id);

-- Keep SERIAL sequences ahead of imported rows with explicit IDs.
SELECT setval(pg_get_serial_sequence('navigation', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM navigation), 1));
SELECT setval(pg_get_serial_sequence('top_links', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM top_links), 1));
SELECT setval(pg_get_serial_sequence('hero_slides', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM hero_slides), 1));
SELECT setval(pg_get_serial_sequence('pages', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM pages), 1));
SELECT setval(pg_get_serial_sequence('members', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM members), 1));
SELECT setval(pg_get_serial_sequence('committee', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM committee), 1));
SELECT setval(pg_get_serial_sequence('posts', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM posts), 1));
SELECT setval(pg_get_serial_sequence('gallery', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM gallery), 1));
SELECT setval(pg_get_serial_sequence('applications', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM applications), 1));
SELECT setval(pg_get_serial_sequence('messages', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM messages), 1));
SELECT setval(pg_get_serial_sequence('forum_posts', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM forum_posts), 1));
SELECT setval(pg_get_serial_sequence('forum_comments', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM forum_comments), 1));

-- Disable Row Level Security (RLS) so the migration script can write data
ALTER TABLE meta DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE navigation DISABLE ROW LEVEL SECURITY;
ALTER TABLE top_links DISABLE ROW LEVEL SECURITY;
ALTER TABLE hero_slides DISABLE ROW LEVEL SECURITY;
ALTER TABLE pages DISABLE ROW LEVEL SECURITY;
ALTER TABLE committee DISABLE ROW LEVEL SECURITY;
ALTER TABLE posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE gallery DISABLE ROW LEVEL SECURITY;
ALTER TABLE applications DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE members DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE forum_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE forum_comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE forum_likes DISABLE ROW LEVEL SECURITY;
