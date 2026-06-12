import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Meme {
  id: string;
  title: string;
  image_url: string;
  category: string;
  tags: string[];
  created_at: string;
}

export const CATEGORIES = [
  { value: "all", label: "全部" },
  { value: "yier", label: "一二" },
  { value: "bubu", label: "布布" },
  { value: "gif", label: "gif" },
  { value: "funny", label: "搞笑" },
  { value: "cute", label: "可爱" },
  { value: "reaction", label: "反应" },
  { value: "mood", label: "心情" },
  { value: "other", label: "其他" },
] as const;
