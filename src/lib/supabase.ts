import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
// The placeholder keeps the client constructible; callers must check configuration
// before issuing requests.
export const supabase = createClient(
  supabaseUrl || "http://127.0.0.1:54321",
  supabaseAnonKey || "not-configured",
);

export interface Tag {
  id: string;
  name: string;
  created_at: string;
}

export interface TagOption {
  value: string;
  label: string;
}

export interface Meme {
  id: string;
  title: string;
  image_url: string;
  category: string;
  image_url_hash: string | null;
  phash: string | null;
  created_at: string;
  tags?: string[];
}
