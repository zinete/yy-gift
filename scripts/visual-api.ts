import { execFile } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";

type Job = { state: "running" | "done" | "failed"; progress?: string; result?: unknown; error?: string };
const assetsDirectory = resolve(".visual-assets");
const assetName = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.(gif|png|jpg|webp|bmp)$/;
const imageTypes: Record<string, string> = { gif: "image/gif", png: "image/png", jpg: "image/jpeg", webp: "image/webp", bmp: "image/bmp" };

async function listAssets(ids: unknown) {
  if (!Array.isArray(ids) || ids.length > 100) throw new Error("每次最多查询 100 张本地图片");
  const entries = await readdir(assetsDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const requested = new Set(ids);
  return Object.fromEntries(entries.flatMap(entry => {
    const id = entry.isFile() && assetName.exec(entry.name)?.[1];
    return id && requested.has(id) ? [[id, `/api/visual/assets/${entry.name}`]] : [];
  }));
}

async function serveAsset(route: string, res: ServerResponse) {
  const fileName = route.slice("/api/visual/assets/".length);
  const match = assetName.exec(fileName);
  const file = match && await open(resolve(assetsDirectory, fileName), "r").catch(() => null);
  if (!file || !match) {
    send(res, 404, { error: "本地图片不存在" });
    return;
  }
  let size: number;
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Invalid media file");
    size = stats.size;
  } catch {
    await file.close();
    send(res, 404, { error: "本地图片不可读取" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": imageTypes[match[2]],
    "Content-Length": size,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-cache",
  });
  const stream = file.createReadStream();
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

export function visualApi(): Plugin {
  let job: Job | undefined;
  let searching = false;
  const run = (args: string[], timeout: number, onProgress?: (progress: string) => void) =>
    new Promise<unknown>((resolve, reject) => {
      const child = execFile(process.env.YY_PYTHON || "python", ["-X", "utf8", "scripts/visual_index.py", ...args], {
        timeout, encoding: "utf8", windowsHide: true, maxBuffer: 512 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim().split(/\r?\n/).at(-1)?.slice(0, 240) ||
            (error.killed ? "本地识图任务超时" : "无法运行识图脚本，请检查 Python、Pillow 和 requests")));
          return;
        }
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error("识图脚本返回了无效结果")); }
      });
      child.stderr?.on("data", (chunk: string) => onProgress?.(chunk.trim().split(/\r?\n/).at(-1) ?? ""));
    });

  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const route = req.url?.split("?")[0];
    if (!route?.startsWith("/api/visual/")) { next(); return; }
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host) ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") ||
        (origin && origin !== `http://${host}`) || req.headers["sec-fetch-site"] === "cross-site") {
      send(res, 403, { error: "本地识图接口仅允许本机访问" });
      return;
    }
    if (req.method === "GET" && route === "/api/visual/job") {
      send(res, 200, { job });
      return;
    }
    if (req.method === "GET" && route.startsWith("/api/visual/assets/")) {
      await serveAsset(route, res);
      return;
    }
    if (req.method !== "POST" || req.headers["content-type"]?.split(";")[0] !== "application/json") {
      send(res, 405, { error: "请使用 JSON 请求" });
      return;
    }
    try {
      let body = "";
      req.setEncoding("utf8");
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 12_000) { send(res, 413, { error: "请求内容过长" }); return; }
      }
      const input = JSON.parse(body);
      if (route === "/api/visual/assets") {
        send(res, 200, { assets: await listAssets(input?.ids) });
        return;
      }
      const query = typeof input?.query === "string" ? input.query.trim() : "";
      if (route === "/api/visual/search") {
        if (!query || query.length > 500) { send(res, 400, { error: "请输入 1–500 字的画面描述" }); return; }
        if (job?.state === "running" || searching) { send(res, 409, { error: "本地模型忙，请稍后再试" }); return; }
        searching = true;
        try {
          const results = await run(["search", `--query=${query}`, "--limit", "12"], 135_000);
          send(res, 200, { results });
        } finally { searching = false; }
        return;
      }
      const action = route === "/api/visual/index" ? "index" : route === "/api/visual/crawl" ? "crawl" : null;
      if (!action) { send(res, 404, { error: "未知识图接口" }); return; }
      if (action === "crawl" && (!query || query.length > 2_000 || query.startsWith("-") || query.includes("\0"))) {
        send(res, 400, { error: "请输入关键词或公开图片链接" });
        return;
      }
      if (job?.state === "running" || searching) { send(res, 409, { error: "本地模型忙，请等当前任务完成" }); return; }
      const requestedLimit = input?.limit;
      const limit = action === "index"
        ? (typeof requestedLimit === "number" && Number.isInteger(requestedLimit)
          ? Math.max(1, Math.min(requestedLimit, 250)) : 250)
        : 5;
      const args = [action, "--limit", String(limit)];
      if (action === "crawl") args.push(`--query=${query}`);
      const current: Job = { state: "running", progress: action === "index" ? "正在读取表情库…" : "正在搜索并识别图片…" };
      job = current;
      void run(args, (limit * 155 + 60) * 1000, (progress) => { current.progress = progress; }).then(
        (result) => Object.assign(current, { state: "done", result }),
        (error: Error) => Object.assign(current, { state: "failed", error: error.message }),
      );
      send(res, 202, { job });
    } catch (error) {
      send(res, 400, { error: error instanceof SyntaxError ? "无效的 JSON 请求" :
        error instanceof Error ? error.message : "本地识图请求失败" });
    }
  }

  return {
    name: "yy-local-visual",
    configureServer(server) { server.middlewares.use((req, res, next) => { void handle(req, res, next); }); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void handle(req, res, next); }); },
  };
}
