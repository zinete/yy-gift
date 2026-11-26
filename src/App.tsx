import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { MemeCard } from "@/components/MemeCard";
import { UploadDialog } from "@/components/UploadDialog";
import { CategoryFilter } from "@/components/CategoryFilter";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { supabase, isSupabaseConfigured, type Meme, type TagOption } from "@/lib/supabase";
import { StoryEditor } from "@/components/StoryEditor";
import { VisualLibraryTools } from "@/components/VisualLibraryTools";
import { preferLocalImages } from "@/lib/visual";
import { Loader2, ImageOff } from "lucide-react";

const PAGE_SIZE = 20;

function App() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [tagOptions, setTagOptions] = useState<TagOption[]>([
    { value: "all", label: "全部" },
  ]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  /** 从 tags 表获取所有 name 作为筛选参数 */
  const fetchTagOptions = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from("tags")
        .select("name")
        .order("name", { ascending: true });

      if (error) throw error;

      const options: TagOption[] = [
        { value: "all", label: "全部" },
        ...(data || []).map((t) => ({ value: t.name, label: t.name })),
      ];
      setTagOptions(options);

      // 如果当前选中的 tag 已被删除，重置为全部
      if (
        selectedTag !== "all" &&
        !options.some((t) => t.value === selectedTag)
      ) {
        setSelectedTag("all");
      }
    } catch (err) {
      console.error("获取标签失败:", err);
    }
  };

  const fetchMemes = async (page: number) => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      let countQuery = supabase
        .from("memes_with_tags")
        .select("*", { count: "exact", head: true });
      if (selectedTag !== "all") {
        const escaped = selectedTag.replace(/"/g, '\\"');
        countQuery = countQuery.filter("tags", "cs", `{"${escaped}"}`);
      }
      const { count } = await countQuery;
      const total = count || 0;
      setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));

      let query = supabase
        .from("memes_with_tags")
        .select("id, title, image_url, category, tags, created_at")
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (selectedTag !== "all") {
        const escaped = selectedTag.replace(/"/g, '\\"');
        query = query.filter("tags", "cs", `{"${escaped}"}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setMemes(await preferLocalImages((data ?? []) as Meme[]));
    } catch (err) {
      console.error("获取表情包失败:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTagOptions();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    fetchMemes(1);
  }, [selectedTag]);

  useEffect(() => {
    if (currentPage > 1) {
      fetchMemes(currentPage);
    }
  }, [currentPage]);

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url.startsWith("/") ? new URL(url, location.origin).href : url);
      alert("图片链接已复制到剪贴板");
    } catch {
      alert("复制失败，请手动复制");
    }
  };

  const handleDelete = async (memeId: string) => {
    try {
      // 1. 先删 memes_tags 关联记录
      const { error: linkError } = await supabase
        .from("memes_tags")
        .delete()
        .eq("meme_id", memeId);

      if (linkError) {
        console.warn("删除关联记录失败:", linkError.message);
      }

      // 2. 再删 memes 主记录
      const { error: memeError } = await supabase
        .from("memes")
        .delete()
        .eq("id", memeId);

      if (memeError) throw memeError;

      // 3. 刷新列表 & tag 选项（有些 tag 可能被删光了）
      setMemes((prev) => prev.filter((m) => m.id !== memeId));
      fetchTagOptions();
    } catch (err) {
      console.error("删除失败:", err);
      alert("删除失败，请稍后重试");
    }
  };

  /** 生成分页项（带省略号） */
  const renderPaginationItems = () => {
    const items: React.ReactNode[] = [];
    const showEllipsisStart = currentPage > 3;
    const showEllipsisEnd = currentPage < totalPages - 2;

    items.push(
      <PaginationItem key={1}>
        <PaginationLink
          isActive={currentPage === 1}
          onClick={() => setCurrentPage(1)}
        >
          1
        </PaginationLink>
      </PaginationItem>,
    );

    if (showEllipsisStart) {
      items.push(<PaginationEllipsis key="start" />);
    }

    for (
      let p = Math.max(2, currentPage - 1);
      p <= Math.min(totalPages - 1, currentPage + 1);
      p++
    ) {
      items.push(
        <PaginationItem key={p}>
          <PaginationLink
            isActive={currentPage === p}
            onClick={() => setCurrentPage(p)}
          >
            {p}
          </PaginationLink>
        </PaginationItem>,
      );
    }

    if (showEllipsisEnd) {
      items.push(<PaginationEllipsis key="end" />);
    }

    if (totalPages > 1) {
      items.push(
        <PaginationItem key={totalPages}>
          <PaginationLink
            isActive={currentPage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
          >
            {totalPages}
          </PaginationLink>
        </PaginationItem>,
      );
    }

    return items;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-7xl mx-auto px-4 pt-6 flex gap-3">
        <button className="rounded-md bg-black text-white px-4 py-2" onClick={() => setEditorOpen(!editorOpen)}>{editorOpen ? "返回表情包库" : "创建短剧"}</button>
      </div>

      {editorOpen ? <StoryEditor /> : <>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 操作栏 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <CategoryFilter
            selected={selectedTag}
            onSelect={setSelectedTag}
            categories={tagOptions}
          />
          <UploadDialog
            supabase={supabase}
            onUploadSuccess={() => {
              fetchTagOptions();
              fetchMemes(currentPage);
            }}
          />
        </div>

        <VisualLibraryTools onImported={() => {
          void fetchTagOptions();
          void fetchMemes(currentPage);
        }} />

        {/* 表情包网格 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">加载中...</span>
          </div>
        ) : memes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ImageOff className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg">暂无表情包</p>
            <p className="text-sm mt-1">点击上方按钮上传第一个表情包吧！</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {memes.map((meme) => (
                <MemeCard
                  key={meme.id}
                  meme={meme}
                  onCopy={handleCopy}
                  onDelete={handleDelete}
                />
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="mt-10">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() =>
                          setCurrentPage((prev) => Math.max(1, prev - 1))
                        }
                        className={
                          currentPage <= 1
                            ? "pointer-events-none opacity-50"
                            : ""
                        }
                      />
                    </PaginationItem>

                    {renderPaginationItems()}

                    <PaginationItem>
                      <PaginationNext
                        onClick={() =>
                          setCurrentPage((prev) =>
                            Math.min(totalPages, prev + 1),
                          )
                        }
                        className={
                          currentPage >= totalPages
                            ? "pointer-events-none opacity-50"
                            : ""
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t mt-12 py-6 text-center text-sm text-muted-foreground">
        <p>YY 表情包 - 收集快乐，分享表情</p>
      </footer>
      </>}
    </div>
  );
}

export default App;
