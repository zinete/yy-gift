-- 创建表情包表
CREATE TABLE IF NOT EXISTS memes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 RLS
ALTER TABLE memes ENABLE ROW LEVEL SECURITY;

-- 允许所有人读取
CREATE POLICY "允许公开读取" ON memes FOR SELECT USING (true);

-- 允许所有人插入（匿名上传）
CREATE POLICY "允许所有人插入" ON memes FOR INSERT WITH CHECK (true);

-- 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_memes_category ON memes(category);
CREATE INDEX IF NOT EXISTS idx_memes_created_at ON memes(created_at DESC);

-- ============ 场景系统 ============

-- 音乐素材表
CREATE TABLE IF NOT EXISTS music_tracks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'bgm',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE music_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "允许公开读取音乐" ON music_tracks FOR SELECT USING (true);
CREATE POLICY "允许插入音乐" ON music_tracks FOR INSERT WITH CHECK (true);

-- 故事项目表（用户创作的作品）
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '未命名作品',
  description TEXT,
  template_id UUID REFERENCES story_templates(id),
  music_track_id UUID REFERENCES music_tracks(id),
  status TEXT NOT NULL DEFAULT 'draft', -- draft / published
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "允许公开读取项目" ON projects FOR SELECT USING (true);
CREATE POLICY "允许创建项目" ON projects FOR INSERT WITH CHECK (true);
CREATE POLICY "允许更新自己的项目" ON projects FOR UPDATE USING (true);

-- 项目场景表（时间线上的每个场景）
CREATE TABLE IF NOT EXISTS project_scenes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  meme_id UUID REFERENCES memes(id),          -- 选中的表情包
  image_url TEXT,                              -- 或自定义图片URL
  duration_ms INTEGER NOT NULL DEFAULT 2000,   -- 场景时长(毫秒)
  text_overlay TEXT,                           -- 文字叠加
  text_position TEXT NOT NULL DEFAULT 'bottom-center', -- top-left/top-right/bottom-left/bottom-right/center
  transition TEXT NOT NULL DEFAULT 'fade',     -- fade/slide/none
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "允许公开读取场景" ON project_scenes FOR SELECT USING (true);
CREATE POLICY "允许创建场景" ON project_scenes FOR INSERT WITH CHECK (true);
CREATE POLICY "允许更新场景" ON project_scenes FOR UPDATE USING (true);
CREATE POLICY "允许删除场景" ON project_scenes FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_project_scenes_project ON project_scenes(project_id, sort_order);

-- AI 故事模板表
CREATE TABLE IF NOT EXISTS story_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  theme TEXT NOT NULL,                          -- 主题关键词
  mood TEXT NOT NULL DEFAULT 'funny',           -- 情绪: funny/warm/sad/exciting/calm
  description TEXT,                             -- AI 生成的故事描述
  scenes_json JSONB NOT NULL DEFAULT '[]',      -- 预设场景 [{order, description, suggested_tags, duration_ms, text_hint}]
  music_suggestion TEXT,                        -- 建议的音乐风格
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE story_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "允许公开读取模板" ON story_templates FOR SELECT USING (true);
CREATE POLICY "允许创建模板" ON story_templates FOR INSERT WITH CHECK (true);
