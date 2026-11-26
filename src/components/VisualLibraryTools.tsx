import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { visualRequest } from "@/lib/visual";

type Result = {
  total?: number;
  pending?: number;
  indexed?: number;
  found?: number;
  saved?: number;
  restored?: number;
  duplicate?: number;
  failed: number;
  errors: string[];
  items?: { description: string; tags: string[]; index_error?: string }[];
};
type Job = { state: "running" | "done" | "failed"; progress?: string; result?: Result; error?: string };

function summary(result: Result) {
  if (result.saved !== undefined) {
    return result.found
      ? `入库 ${result.saved} 张，迁移 ${result.restored ?? 0} 张，重复 ${result.duplicate} 张，失败 ${result.failed} 张。`
      : "搜索源没有返回可用图片。可以换个关键词或粘贴图片直链。";
  }
  return result.pending
    ? `新增索引 ${result.indexed} 张，失败 ${result.failed} 张。表情库共 ${result.total} 张。`
    : `表情库的 ${result.total} 张图片已建立索引。`;
}

export function VisualLibraryTools({ onImported }: { onImported: () => void }) {
  const [query, setQuery] = useState("");
  const [job, setJob] = useState<Job>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const refreshLibrary = useRef(onImported);
  useEffect(() => { refreshLibrary.current = onImported; }, [onImported]);
  const running = job?.state === "running";

  useEffect(() => {
    let live = true;
    async function refresh() {
      try {
        const status = await visualRequest<{ job?: Job }>("job");
        if (!live) return;
        setJob(status.job);
        const result = status.job?.result;
        if (running && status.job?.state === "done" && (result?.saved || result?.restored)) refreshLibrary.current();
      } catch (error) {
        if (live) setError(error instanceof Error ? error.message : "无法读取任务状态");
      }
    }
    void refresh();
    const timer = running ? window.setInterval(() => void refresh(), 2000) : undefined;
    return () => { live = false; window.clearInterval(timer); };
  }, [running]);

  async function start(action: "index" | "crawl") {
    setSubmitting(true);
    setError("");
    try {
      const response = await visualRequest<{ job: Job }>(action, { query });
      setJob(response.job);
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法启动任务");
    } finally {
      setSubmitting(false);
    }
  }

  const result = job?.result;
  const busy = submitting || running;
  return (
    <details className="mb-6 rounded-lg border bg-background">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">识图索引与网络采集{running && " · 处理中"}</summary>
      <section className="space-y-3 border-t px-4 py-4" aria-label="识图索引与网络采集">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void start("index")}>识别已有素材</Button>
          <p className="text-sm text-muted-foreground">识别后可以在分镜里按画面描述找图。</p>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void start("crawl"); }}>
          <label className="grid min-w-0 flex-1 basis-52 gap-1 text-sm">
            搜索关键词或图片直链
            <input className="h-9 rounded-md border px-3" value={query} maxLength={2000}
              placeholder="例如：小熊抱着零食" onChange={event => setQuery(event.target.value)} />
          </label>
          <Button type="submit" size="sm" disabled={busy || !query.trim()}>采集并分类入库</Button>
        </form>
        <p className="text-sm text-muted-foreground">关键词每次尝试最多 5 张。通过校验的原图上传至 Supabase Storage，并按视觉标签入库。</p>
        {(error || job) && <p role="status" className="break-words text-sm">
          {error || (result ? summary(result) : job?.error || job?.progress)}
        </p>}
        {result?.items?.length ? <ul className="space-y-1 text-sm">
          {result.items.map((item, index) => (
            <li key={index}>{item.description} · {item.tags.join("、")}{item.index_error && "（语义索引待补建）"}</li>
          ))}
        </ul> : null}
        {result?.errors.length ? <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">查看失败原因</summary>
          <ul className="mt-2 list-disc space-y-1 break-words pl-5">
            {result.errors.slice(0, 10).map((reason, index) => <li key={index}>{reason}</li>)}
          </ul>
        </details> : null}
      </section>
    </details>
  );
}
