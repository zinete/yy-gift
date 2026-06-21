import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, X, Plus } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface UploadDialogProps {
  supabase: SupabaseClient;
  onUploadSuccess: () => void;
}

export function UploadDialog({ supabase, onUploadSuccess }: UploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [existingTagNames, setExistingTagNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchExistingTags = async () => {
    try {
      const { data, error } = await supabase
        .from("tags")
        .select("name")
        .order("name", { ascending: true });
      if (error) throw error;
      setExistingTagNames((data || []).map((t) => t.name));
    } catch (err) {
      console.error("拉取标签失败:", err);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    fetchExistingTags();
  };

  const chooseTag = (tag: string) => {
    // 单选：点已选的自己则取消
    setSelectedTag((prev) => (prev === tag ? null : tag));
    setTagInput("");
  };

  const addCustomTag = () => {
    const name = tagInput.trim();
    if (!name) return;
    setSelectedTag(name);
    if (!existingTagNames.includes(name)) {
      setExistingTagNames((prev) => [...prev, name].sort());
    }
    setTagInput("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !imageUrl.trim()) return;

    setLoading(true);
    try {
      const { data: memeData, error: memeError } = await supabase
        .from("memes")
        .insert({
          title: title.trim(),
          image_url: imageUrl.trim(),
          category: "other",
        })
        .select("id");

      if (memeError) throw memeError;
      const memeId = memeData?.[0]?.id;
      if (!memeId) throw new Error("未返回 meme id");

      if (selectedTag) {
        const { data: existingTags } = await supabase
          .from("tags")
          .select("id, name")
          .eq("name", selectedTag);

        let tagId: string | null = existingTags?.[0]?.id ?? null;

        if (!tagId) {
          const { data: newTags, error: tagError } = await supabase
            .from("tags")
            .insert({ name: selectedTag })
            .select("id");

          if (tagError) {
            console.warn("tag 插入失败:", tagError.message);
          } else {
            tagId = newTags?.[0]?.id ?? null;
          }
        }

        if (tagId) {
          const { error: linkError } = await supabase
            .from("memes_tags")
            .insert({ meme_id: memeId, tag_id: tagId });

          if (linkError) {
            console.warn("标签关联失败:", linkError.message);
          }
        }
      }

      setTitle("");
      setImageUrl("");
      setSelectedTag(null);
      setTagInput("");
      setOpen(false);
      onUploadSuccess();
    } catch (err) {
      console.error("上传失败:", err);
      alert("上传失败，请检查输入或稍后重试");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={handleOpen} className="gap-2">
        <Upload className="h-4 w-4" />
        上传表情包
      </Button>
    );
  }

  const suggestTags = existingTagNames.filter((t) => t !== selectedTag);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      <div className="relative bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">上传表情包</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-sm opacity-70 hover:opacity-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">标题</Label>
            <Input
              id="title"
              placeholder="给表情包起个名字"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">图片链接</Label>
            <Input
              id="url"
              placeholder="https://example.com/image.png"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>选择标签（一张图一个标签）</Label>

            {selectedTag && (
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant="secondary"
                  className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  onClick={() => setSelectedTag(null)}
                  title="点击取消"
                >
                  {selectedTag} ×
                </Badge>
              </div>
            )}

            {suggestTags.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  已有标签（点击选择）
                </p>
                <div className="flex flex-wrap gap-1">
                  {suggestTags.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => chooseTag(t)}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                id="custom-tag"
                placeholder="输入自定义标签后回车"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomTag();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={addCustomTag}
                disabled={!tagInput.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              点击已有标签选择；也可输入自定义标签；不存在的标签会自动新建
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "上传中..." : "确认上传"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
