import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { createClient, WebSocketLikeConstructor } from "@supabase/supabase-js";
import ws from "ws";

// ============ 配置 ============
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { transport: ws as unknown as WebSocketLikeConstructor },
});

interface CrawlConfig {
  keyword: string;
  category: string;
  tags: string[];
  maxImages: number;
}

// ============ 核心：百度 objURL 自定义编码解码 ============

/**
 * 百度图片搜索 API 返回的 objURL 使用了自定义字符替换编码：
 *   _z2C$q  →  :
 *   _z&e3B  →  .
 *   AzdH3F  →  /
 *
 * 解码顺序：先做字符替换，再做 URI decode（可能多层）
 */
function decodeBaiduObjUrl(encoded: string): string {
  if (!encoded) return "";

  let url = encoded;

  // 百度自定义字符替换解码
  const replacements: [string, string][] = [
    ["_z2C$q", ":"],
    ["_z&e3B", "."],
    ["AzdH3F", "/"],
  ];

  for (const [from, to] of replacements) {
    url = url.split(from).join(to);
  }

  // 多层 URI 解码
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(url);
      if (decoded === url) break;
      url = decoded;
    } catch {
      break;
    }
  }

  return url;
}

// ============ 工具函数 ============

function isValidImageUrl(url: string): boolean {
  if (!url || url.length < 10) return false;
  const skipPatterns = [/favicon/i, /logo/i, /icon/i, /tracker/i, /\.svg$/i];
  if (skipPatterns.some((p) => p.test(url))) return false;
  // 必须包含图片扩展名或已知图片 CDN 域名
  const exts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  const lower = url.toLowerCase();
  return (
    exts.some((ext) => lower.includes(ext)) ||
    lower.includes("itc.cn") ||
    lower.includes("sinaimg") ||
    lower.includes("bcebos") ||
    lower.includes("img0.baidu.com") ||
    lower.includes("img1.baidu.com")
  );
}

function generateTitle(url: string, keyword?: string): string {
  if (keyword)
    return `${keyword}_${url.split("/").pop()?.split("?")[0]?.slice(0, 30) || ""}`;
  const filename = url.split("/").pop()?.split("?")[0] || "未命名";
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]/g, " ")
      .slice(0, 50) || "未命名表情包"
  );
}

// ============ 步骤1：百度搜索 API 获取图片列表 ============

async function searchBaiduImages(
  keyword: string,
  maxImages: number,
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  const pageSize = 30;
  const pages = Math.ceil(maxImages / pageSize);

  console.log(`\n🔍 搜索关键词: "${keyword}"`);

  for (let page = 0; page < pages; page++) {
    const pn = page * pageSize;
    const apiUrl = `https://image.baidu.com/search/acjson?tn=resultjson_com&word=${encodeURIComponent(keyword)}&pn=${pn}&rn=${pageSize}&ie=utf-8`;

    try {
      const res = await axios.get(apiUrl, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Referer: "https://image.baidu.com/",
          Accept: "application/json, text/plain, */*",
        },
      });

      const data = res.data;
      const items: Record<string, unknown>[] = (data?.data || []).filter(
        (item: unknown): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      );
      allItems.push(...items);

      console.log(`   📄 第 ${page + 1} 页: 获取 ${items.length} 条结果`);
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.log(`   ⚠️ 第 ${page + 1} 页失败: ${(err as Error).message}`);
    }

    if (allItems.length >= maxImages) break;
  }

  console.log(`   共获取 ${allItems.length} 条原始结果`);
  return allItems.slice(0, maxImages);
}

// ============ 步骤2：提取每张图的原图 URL ============

/**
 * 提取策略（按优先级）：
 * 1. replaceUrl → 百度提供的替换/高清 URL（最可靠）
 * 2. objURL 字段 → 百度自定义编码解码 → 原图
 * 3. hoverURL 字段 → 直接使用或简单解码
 * 4. middleURL → 中等质量备选
 * 5. 构造完整详情页 URL 访问，从重定向/页面中提取 objurl
 */
async function extractOriginalUrl(
  item: Record<string, unknown>,
  index: number,
): Promise<string | null> {
  const getString = (key: string): string => {
    const val = item[key];
    return typeof val === "string" ? val : "";
  };

  // --- 策略1：replaceUrl（最高优先级，百度直接给的高清/原图） ---
  const replaceUrlRaw = item["replaceUrl"];
  if (
    Array.isArray(replaceUrlRaw) &&
    replaceUrlRaw.length > 0 &&
    replaceUrlRaw[0] &&
    typeof replaceUrlRaw[0] === "object"
  ) {
    const first = replaceUrlRaw[0] as Record<string, unknown>;
    const objUrl = first["ObjURL"] || first["objURL"] || first["url"] || "";
    if (typeof objUrl === "string" && isValidImageUrl(objUrl)) {
      console.log(
        `   [${index}] ✅ replaceUrl 原图: ${objUrl.slice(0, 55)}...`,
      );
      return objUrl;
    }
    // 尝试解码（有时也是编码的）
    if (typeof objUrl === "string" && objUrl) {
      const decoded = decodeBaiduObjUrl(objUrl);
      if (isValidImageUrl(decoded)) {
        console.log(
          `   [${index}] ✅ replaceUrl 解码后: ${decoded.slice(0, 55)}...`,
        );
        return decoded;
      }
    }
  }
  const rawObjUrl = getString("objURL");
  if (rawObjUrl) {
    const decoded = decodeBaiduObjUrl(rawObjUrl);
    if (isValidImageUrl(decoded)) {
      console.log(
        `   [${index}] ✅ objURL 解码成功: ${decoded.slice(0, 55)}...`,
      );
      return decoded;
    }
    // 打印解码后的值方便调试
    if (decoded && decoded !== rawObjUrl) {
      console.log(
        `   [${index}] ℹ️  objURL 解码后非图片: ${decoded.slice(0, 60)}`,
      );
    }
  }

  // --- 策略2：hoverURL ---
  const hoverUrl = getString("hoverURL");
  if (hoverUrl && isValidImageUrl(hoverUrl)) {
    console.log(`   [${index}] ✅ hoverURL 可用: ${hoverUrl.slice(0, 55)}...`);
    return hoverUrl;
  }
  // eslint-disable-next-line no-useless-assignment
  let decodedHover = "";
  if (hoverUrl) {
    decodedHover = decodeBaiduObjUrl(hoverUrl);
    if (isValidImageUrl(decodedHover)) {
      console.log(
        `   [${index}] ✅ hoverURL 解码成功: ${decodedHover.slice(0, 55)}...`,
      );
      return decodedHover;
    }
  }

  // --- 策略3：middleURL ---
  const middleUrl = getString("middleURL");
  if (middleUrl && isValidImageUrl(middleUrl)) {
    console.log(
      `   [${index}] ✅ middleURL 可用: ${middleUrl.slice(0, 55)}...`,
    );
    return middleUrl;
  }

  // --- 策略4：构造详情页 URL 提取 ---
  const di = getString("di");
  if (!di) {
    console.log(`   [${index}] ❌ 无 di 且所有字段均无效，跳过`);
    return null;
  }

  console.log(`   [${index}] 🔍 尝试详情页提取 (di=${di})...`);

  try {
    // 用 API 返回的字段尽量多地构造详情页参数
    const fromurl = getString("fromURL") || "";
    const cs = getString("cs") || "";
    const os = getString("os") || "";
    const simid = getString("simid") || "";

    // 将 objURL 编码后作为 objurl 参数传入（模拟真实详情页 URL）
    let encodedObjurl = "";
    try {
      encodedObjurl = encodeURIComponent(
        encodeURIComponent(rawObjUrl || hoverUrl || ""),
      );
    } catch {
      /* ignore */
    }

    const detailParams = new URLSearchParams({
      tn: "baiduimagedetail",
      di,
      ie: "utf-8",
      word: "", // 由调用方设置
      ...(encodedObjurl ? { objurl: encodedObjurl } : {}),
      ...(fromurl ? { fromurl: encodeURIComponent(fromurl) } : {}),
      ...(cs ? { cs } : {}),
      ...(os ? { os } : {}),
      ...(simid ? { simid } : {}),
    });

    const detailUrl = `https://image.baidu.com/search/detail?${detailParams.toString()}`;

    const res = await axios.get(detailUrl, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://image.baidu.com/",
        Accept: "text/html,application/xhtml+xml",
      },
      maxRedirects: 5,
    });

    // 从最终重定向 URL 中提取 objurl
    const redirectChain = res.request?.redirects || [];

    let extractedUrl = "";

    // 尝试从重定向链中找带 objurl 的 URL
    for (const redirectUrl of [...redirectChain].reverse()) {
      try {
        const params = new URL(redirectUrl).searchParams;
        const objurl = params.get("objurl") || params.get("objURL") || "";
        if (objurl) {
          extractedUrl = decodeBaiduObjUrl(objurl);
          if (isValidImageUrl(extractedUrl)) break;
          else extractedUrl = "";
        }
      } catch {
        /* continue */
      }
    }

    // 从 HTML 内容中提取大图
    if (!extractedUrl || !isValidImageUrl(extractedUrl)) {
      const $ = cheerio.load(res.data);

      // 找最大的图片（通常是主图）
      let bestImg = "";
      let bestSize = 0;

      $("img").each((_, el) => {
        const src =
          $(el).attr("src") ||
          $(el).attr("data-imgurl") ||
          $(el).attr("data-src") ||
          "";
        if (
          src &&
          !src.startsWith("data:") &&
          src.length > bestSize &&
          (src.includes("itc.cn") ||
            src.includes("sinaimg") ||
            src.includes("bcebos") ||
            src.includes(".gif"))
        ) {
          bestImg = src;
          bestSize = src.length;
        }
      });

      if (bestImg) extractedUrl = bestImg;
    }

    // 从内联 JSON 数据中提取
    if (!extractedUrl || !isValidImageUrl(extractedUrl)) {
      const html = typeof res.data === "string" ? res.data : "";
      const patterns = [
        /"objURL"\s*:\s*"([^"]+)"/i,
        /objurl["']?\s*[:=]\s*['"]([^'"]+)/i,
        /"originURL"\s*:\s*"([^"]+)"/i,
      ];
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
          const decoded = decodeBaiduObjUrl(match[1]);
          if (isValidImageUrl(decoded)) {
            extractedUrl = decoded;
            break;
          }
        }
      }
    }

    if (extractedUrl && isValidImageUrl(extractedUrl)) {
      console.log(
        `   [${index}] ✅ 详情页提取成功: ${extractedUrl.slice(0, 55)}...`,
      );
      return extractedUrl;
    }

    console.log(`   [${index}] ⚠️ 详情页也未找到有效原图`);
    return null;
  } catch (err) {
    console.log(`   [${index}] ⚠️ 详情页请求失败: ${(err as Error).message}`);
    return null;
  }
}

// ============ 步骤3：图片可达性校验 ============

/**
 * 检查图片是否可公开访问（模拟前端 <img> 标签跨域加载行为）
 * - 带 Origin / Referer 头，触发防盗链检测（如 hdslb.com、sinaimg.cn）
 * - 403/404 等错误状态码 → 不可访问
 * - 返回非图片内容 → 不可访问
 * - 文件过小 → 视为无效
 * - 文件头魔数不匹配 → 视为 ORB 阻截风险，拒绝
 */
async function isImageAccessible(url: string): Promise<boolean> {
  try {
    // 关键：模拟浏览器跨域 <img> 请求，带 Origin 和 Referer
    // 部分 CDN（hdslb.com 等）对无 Origin 的请求放行，但浏览器请求会被 403
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        // 模拟跨域页面中的 <img> 标签请求
        Origin: "https://example.com",
        Referer: "https://example.com/",
        Range: "bytes=0-1023",
      },
      maxRedirects: 5,
      responseType: "arraybuffer",
      // 不自动解压，保留原始响应
      decompress: false,
    });

    if (res.status >= 400) return false;

    // Content-Type 必须是图片
    const contentType = String(res.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("image/")) return false;

    // 数据长度检查
    const buf = res.data as ArrayBuffer;
    if (!buf || buf.byteLength < 100) return false;

    // 文件头魔数校验 — 防止 ORB 拦截（Content-Type 声称是图片但实际不是）
    const bytes = new Uint8Array(buf.slice(0, 12));
    if (!isValidImageMagicBytes(bytes)) return false;

    return true;
  } catch {
    return false;
  }
}

/** 通过文件头魔数判断是否为真实图片 */
function isValidImageMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;

  // PNG: 89 50 4E 47
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return true;

  // GIF: 47 49 46 38 ('GIF8')
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return true;

  // WebP: RIFF....WEBP (需要12字节)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  )
    return true;

  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true;

  return false;
}

// ============ 步骤4：保存到 Supabase（带可达性校验） ============

async function saveToSupabase(
  urls: string[],
  config: CrawlConfig,
): Promise<number> {
  const { category, tags } = config;
  let saved = 0;
  let skipped = 0;

  for (const url of urls) {
    // 校验图片是否可访问
    const accessible = await isImageAccessible(url);
    if (!accessible) {
      console.log(`   🔗 不可访问，跳过: ${url.slice(0, 50)}...`);
      skipped++;
      continue;
    }

    const title = generateTitle(url, config.keyword);

    const { error } = await supabase.from("memes").insert({
      title,
      image_url: url,
      category,
      tags,
    });

    if (error) {
      if (error.code === "23505") {
        console.log(`   ⏭️ 已存在: ${title.slice(0, 40)}`);
      } else {
        console.log(`   ❌ 失败: ${error.message}`);
      }
    } else {
      saved++;
      console.log(`   ✅ 保存成功 (${saved}): ${title.slice(0, 40)}`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  if (skipped > 0) {
    console.log(`\n   ⚠️ 因不可访问跳过 ${skipped} 张图片`);
  }

  return saved;
}

// ============ 主流程 ============

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`
🎨 YY 表情包爬虫（高清可动版 - GIF 动图）

用法:
  npx tsx scripts/crawler-hd.ts <关键词> [选项]

选项:
  --category <分类>   存入分类 (默认: other)
  --tags <标签>      标签，逗号分隔 (默认: 爬取)
  --max <数量>       最多爬取数量 (默认: 20)

示例:
  npx tsx scripts/crawler-hd.ts "一二布布 gif" --category bubu --tags 布布,可爱,gif --max 30
  npx tsx scripts/crawler-hd.ts "搞笑表情包" --category funny --max 50
  npx tsx scripts/crawler-hd.ts "猫猫表情包" --category cute --tags 猫猫,可爱

说明:
  本脚本会通过百度自定义编码解码 objURL 来获取高清/可动原图，
  相比普通爬虫能正确获取 GIF 动图而非静态缩略图。
    `);
    return;
  }

  const keyword = args[0];

  const getArg = (name: string, fallback: string) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const config: CrawlConfig = {
    keyword,
    category: getArg("category", "other"),
    tags: getArg("tags", "爬取")
      .split(",")
      .map((t) => t.trim()),
    maxImages: parseInt(getArg("max", "20"), 10),
  };

  console.log("📋 爬取配置:", {
    keyword: config.keyword,
    category: config.category,
    tags: config.tags,
    maxImages: config.maxImages,
  });

  try {
    // 1. 搜索
    const items = await searchBaiduImages(config.keyword, config.maxImages);
    if (items.length === 0) {
      console.log("\n❌ 未搜索到任何图片");
      return;
    }

    // 2. 逐个提取原图
    console.log(`\n🔎 开始提取原图 URL（共 ${items.length} 张）...\n`);
    const originalUrls: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const url = await extractOriginalUrl(items[i], i + 1);

      if (url && !seen.has(url) && isValidImageUrl(url)) {
        seen.add(url);
        originalUrls.push(url);
      }

      await new Promise((r) => setTimeout(r, 600));
      if (originalUrls.length >= config.maxImages) break;
    }

    console.log(`\n📊 成功提取 ${originalUrls.length} 张原图 URL`);

    if (originalUrls.length === 0) {
      console.log("\n⚠️ 所有图片均未能提取原图");
      return;
    }

    // 3. 入库
    console.log(`\n💾 开始保存到数据库...\n`);
    const saved = await saveToSupabase(originalUrls, config);
    console.log(`\n🎉 完成！共保存 ${saved} 张高清/可动表情包`);
  } catch (err) {
    console.error("\n💥 爬取失败:", err instanceof Error ? err.message : err);
  }
}

main();
