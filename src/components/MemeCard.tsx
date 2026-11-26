import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Meme } from "@/lib/supabase";
import { Copy, Download, Heart, ImageOff, Trash2 } from "lucide-react";

interface MemeCardProps {
  meme: Meme;
  onCopy: (url: string) => void;
  onDelete: (memeId: string) => void;
}

export function MemeCard({ meme, onCopy, onDelete }: MemeCardProps) {
  const [failedUrl, setFailedUrl] = useState("");
  const unavailable = failedUrl === meme.image_url;
  const tags: string[] = Array.isArray(meme.tags) ? meme.tags : [];
  const primaryTag = tags[0];

  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
      <CardContent className="p-0">
        <div className="relative aspect-square overflow-hidden bg-muted">
          {unavailable ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground" title={meme.title}>
              <ImageOff className="h-5 w-5" aria-hidden />
              <p className="text-sm">图片暂不可用</p>
            </div>
          ) : (
            <img
              src={meme.image_url}
              alt={meme.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailedUrl(meme.image_url)}
            />
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-end justify-between p-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <div className="flex flex-col gap-1">
              {primaryTag && (
                <Badge variant="outline" className="bg-white/70 text-xs">
                  {primaryTag}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onCopy(meme.image_url)}
                className="p-2 rounded-full bg-white/90 hover:bg-white text-foreground transition-colors"
                title="复制图片链接"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(meme.image_url, { referrerPolicy: "no-referrer" });
                    if (!res.ok) throw new Error("图片下载失败");
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download =
                      meme.title?.replace(/[/\\?%*:|"<>]/g, "_") || "image";
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {
                    window.open(meme.image_url, "_blank");
                  }
                }}
                className="p-2 rounded-full bg-white/90 hover:bg-white text-foreground transition-colors"
                title="下载图片"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                className="p-2 rounded-full bg-white/90 hover:bg-white text-red-500 transition-colors"
                title="收藏"
              >
                <Heart className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (confirm("确定删除这张表情包吗？")) {
                    onDelete(meme.id);
                  }
                }}
                className="p-2 rounded-full bg-white/90 hover:bg-red-500 hover:text-white text-red-500 transition-colors"
                title="删除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
