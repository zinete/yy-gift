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
import { supabase, type Meme } from "@/lib/supabase";
import { Loader2, ImageOff } from "lucide-react";

const PAGE_SIZE = 20;

function App() {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchMemes = async (page: number) => {
    setLoading(true);
    try {
      // 先查总数
      let countQuery = supabase
        .from("memes")
        .select("*", { count: "exact", head: true });
      if (selectedCategory !== "all") {
        countQuery = countQuery.eq("category", selectedCategory);
      }
      const { count } = await countQuery;
      const total = count || 0;
      setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));

      // 再查当前页数据
      let query = supabase
        .from("memes")
        .select("*")
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (selectedCategory !== "all") {
        query = query.eq("category", selectedCategory);
      }

      const { data, error } = await query;
      if (error) throw error;
      setMemes(data || []);
    } catch (err) {
      console.error("获取表情包失败:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    fetchMemes(1);
  }, [selectedCategory]);

  useEffect(() => {
    if (currentPage > 1) {
      fetchMemes(currentPage);
    }
  }, [currentPage]);

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      alert("图片链接已复制到剪贴板");
    } catch {
      alert("复制失败，请手动复制");
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 操作栏 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <CategoryFilter
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />
          <UploadDialog
            supabase={supabase}
            onUploadSuccess={() => fetchMemes(currentPage)}
          />
        </div>

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
                <MemeCard key={meme.id} meme={meme} onCopy={handleCopy} />
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
    </div>
  );
}

export default App;
