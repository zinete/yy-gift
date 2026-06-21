import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
