import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Meme } from "@/lib/supabase";
import { Copy, Download, Heart } from "lucide-react";

interface MemeCardProps {
  meme: Meme;
  onCopy: (url: string) => void;
}

export function MemeCard({ meme, onCopy }: MemeCardProps) {
  const categoryLabels: Record<string, string> = {
    funny: "搞笑",
    cute: "可爱",
    reaction: "反应",
    mood: "心情",
    other: "其他",
  };

  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
      <CardContent className="p-0">
        <div className="relative aspect-square overflow-hidden bg-muted">
          <img
            src={meme.image_url}
            alt={meme.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-end justify-between p-3 opacity-0 group-hover:opacity-100">
            <Badge variant="secondary" className="bg-white/90 text-foreground">
              {categoryLabels[meme.category] || meme.category}
            </Badge>
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
                    const res = await fetch(meme.image_url);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download =
                      meme.title?.replace(/[/\\?%*:|"<>]/g, "_") || "image";
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch {
                    // 降级：直接打开
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
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
