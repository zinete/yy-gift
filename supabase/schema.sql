-- ============ 标签系统（多对多） ============

CREATE TABLE IF NOT EXISTS tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tags_name_unique UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "允许公开读取标签" ON tags;
CREATE POLICY "允许公开读取标签" ON tags FOR SELECT USING (true);
DROP POLICY IF EXISTS "允许插入标签" ON tags;
CREATE POLICY "允许插入标签" ON tags FOR INSERT WITH CHECK (true);

-- ============ 表情包表 ============

CREATE TABLE IF NOT EXISTS memes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  image_url_hash TEXT,
  phash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE memes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "允许公开读取" ON memes;
CREATE POLICY "允许公开读取" ON memes FOR SELECT USING (true);
DROP POLICY IF EXISTS "允许所有人插入" ON memes;
CREATE POLICY "允许所有人插入" ON memes FOR INSERT WITH CHECK (true);

-- 唯一约束（URL 去重）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'memes_image_url_hash_unique' AND table_name = 'memes'
  ) THEN
    ALTER TABLE memes ADD CONSTRAINT memes_image_url_hash_unique UNIQUE (image_url_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memes_phash ON memes(phash);
CREATE INDEX IF NOT EXISTS idx_memes_category ON memes(category);
CREATE INDEX IF NOT EXISTS idx_memes_created_at ON memes(created_at DESC);

-- ============ 表情包 <-> 标签 关联表 ============

CREATE TABLE IF NOT EXISTS memes_tags (
  meme_id UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (meme_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_memes_tags_tag ON memes_tags(tag_id);

ALTER TABLE memes_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "允许公开读取关联" ON memes_tags;
CREATE POLICY "允许公开读取关联" ON memes_tags FOR SELECT USING (true);
DROP POLICY IF EXISTS "允许插入关联" ON memes_tags;
CREATE POLICY "允许插入关联" ON memes_tags FOR INSERT WITH CHECK (true);

-- ============ 便捷视图：查询表情包及其所有标签 ============

CREATE OR REPLACE VIEW memes_with_tags AS
SELECT
  m.id,
  m.title,
  m.image_url,
  m.category,
  m.image_url_hash,
  m.phash,
  m.created_at,
  ARRAY_AGG(t.name) FILTER (WHERE t.name IS NOT NULL) AS tags
FROM memes m
LEFT JOIN memes_tags mt ON m.id = mt.meme_id
LEFT JOIN tags t ON mt.tag_id = t.id
GROUP BY m.id, m.title, m.image_url, m.category, m.image_url_hash, m.phash, m.created_at;