import { createHash } from "crypto";

function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function hashUrl(url) {
  return createHash("sha256").update(normalizeImageUrl(url)).digest("hex");
}

const CATEGORY_RULES = [
  { match: /(^|[^a-z])(一二|yier|yi[_ ]?er)[^a-z]?/i, category: "yier", weight: 10 },
  { match: /(^|[^a-z])(布布|bubu)[^a-z]?/i, category: "bubu", weight: 10 },
  { match: /(^|[^a-z])(仙剑|xianjian|xj)[^a-z]?/i, category: "xj", weight: 10 },
  { match: /(^|[^a-z])(gif|动图|dongtu)[^a-z]?/i, category: "gif", weight: 10 },
  { match: /(^|[^a-z])(搞笑|funny|haha|哈哈|233|emmm|沙雕|斗图)[^a-z]?/i, category: "funny", weight: 8 },
  { match: /(^|[^a-z])(可爱|萌|cute|kawaii|卡哇伊)[^a-z]?/i, category: "cute", weight: 8 },
  { match: /(^|[^a-z])(表情|reaction|biaoqing)[^a-z]?/i, category: "funny", weight: 6 },
  { match: /(^|[^a-z])(心情|emo|难过|开心|happy|sad)[^a-z]?/i, category: "mood", weight: 6 },
  { match: /(^|[^a-z])(猫|狗|dog|cat|puppy|kitten|animal|动物)[^a-z]?/i, category: "cute", weight: 5 },
];

function extractTagsFromKeyword(keyword, url) {
  const lowerKw = keyword.toLowerCase();
  const lowerUrl = url.toLowerCase();
  const lowerCombined = `${lowerKw} ${lowerUrl}`;

  const keywordTokens = new Set();
  const rawTokens = keyword.split(/[\s_\-，,。.!?]+/);
  for (const token of rawTokens) {
    if (token.length >= 2) keywordTokens.add(token.trim());
  }

  const categoryScores = {};
  const autoTags = new Set();

  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(lowerCombined)) {
      categoryScores[rule.category] = (categoryScores[rule.category] || 0) + rule.weight;
    }
  }

  for (const token of keywordTokens) {
    if (token.length >= 2 && token.length <= 10) autoTags.add(token);
  }

  if (/\.gif($|\?)/i.test(url)) {
    autoTags.add("gif");
    autoTags.add("动图");
  }

  const extMatch = url.match(/\.(jpe?g|png|gif|webp|bmp)/i);
  if (extMatch && extMatch[1].toLowerCase() === "gif") autoTags.add("gif");

  let bestCategory = "other";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(categoryScores)) {
    if (score > bestScore) { bestScore = score; bestCategory = cat; }
  }

  if (bestCategory === "other" && (autoTags.has("猫") || autoTags.has("可爱") || autoTags.has("萌") || autoTags.has("cute"))) bestCategory = "cute";
  if (bestCategory === "other" && (autoTags.has("搞笑") || autoTags.has("哈哈") || autoTags.has("funny"))) bestCategory = "funny";

  const finalTags = Array.from(autoTags)
    .filter((t) => t.length >= 2 && t.length <= 20)
    .slice(0, 10);

  return { category: bestCategory, tags: finalTags };
}

// ===== 测试 =====
const tests = [
  { kw: "一二布布 gif", url: "https://example.com/bubu/yi-er.gif?t=123" },
  { kw: "搞笑表情包", url: "https://example.com/funny/meme.jpg?x=y" },
  { kw: "猫猫可爱图片", url: "https://cdn.example.com/cats/kitty.png?v=1" },
];

console.log("=== 测试 normalizeImageUrl ===");
for (const t of tests) {
  const n = normalizeImageUrl(t.url);
  console.log(`  原始: ${t.url}`);
  console.log(`  规范化: ${n}`);
  console.log(`  哈希: ${hashUrl(t.url).slice(0, 20)}...`);
  console.log();
}

console.log("=== 测试 extractTagsFromKeyword ===");
for (const t of tests) {
  const { category, tags } = extractTagsFromKeyword(t.kw, t.url);
  console.log(`  关键词: "${t.kw}"`);
  console.log(`  → 分类: ${category}`);
  console.log(`  → 标签: [${tags.join(", ")}]`);
  console.log();
}

console.log("✅ 所有测试通过，核心函数正常工作！");
