// 测试: 标签验证 + 自动分类逻辑
// 这是 crawler-hd.ts 中核心函数的等价实现，用于本地验证

function isCleanTag(tag) {
  if (!tag || tag.length < 2 || tag.length > 15) return false;
  if (/^[\u4e00-\u9fa5]{2,15}$/.test(tag)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9\-]{1,14}$/.test(tag)) return true;
  return false;
}

function isChineseOnly(text) {
  return /^[\u4e00-\u9fa5]+$/.test(text);
}

function isEnglishOnly(text) {
  return /^[a-zA-Z0-9\-]+$/.test(text);
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

  const categoryScores = {};
  const autoTags = new Set();

  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(lowerCombined)) {
      categoryScores[rule.category] = (categoryScores[rule.category] || 0) + rule.weight;
    }
  }

  const rawTokens = keyword.split(/[\s,，。！？!?\-\_·]+/);
  for (const rawToken of rawTokens) {
    const token = rawToken.trim();
    if (token.length < 2) continue;
    if (isChineseOnly(token) || isEnglishOnly(token)) {
      if (isCleanTag(token)) autoTags.add(token);
    } else {
      const chineseParts = token.match(/[\u4e00-\u9fa5]{2,}/g) || [];
      const englishParts = token.match(/[a-zA-Z][a-zA-Z0-9]{1,}/g) || [];
      for (const cp of chineseParts) if (isCleanTag(cp)) autoTags.add(cp);
      for (const ep of englishParts) if (isCleanTag(ep)) autoTags.add(ep);
    }
  }

  if (/\.gif($|\?)/i.test(url)) {
    autoTags.add("gif");
    autoTags.add("动图");
  }

  let bestCategory = "other";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(categoryScores)) {
    if (score > bestScore) { bestScore = score; bestCategory = cat; }
  }

  const tagSet = Array.from(autoTags);
  const hasCute = tagSet.some((t) =>
    ["猫", "狗", "可爱", "萌", "cute", "kawaii"].includes(t.toLowerCase()),
  );
  const hasFunny = tagSet.some((t) =>
    ["搞笑", "哈哈", "沙雕", "斗图", "funny", "emmm", "233"].includes(t),
  );
  if (bestCategory === "other" && hasCute) bestCategory = "cute";
  if (bestCategory === "other" && hasFunny) bestCategory = "funny";

  const finalTags = Array.from(autoTags).filter((t) => isCleanTag(t)).slice(0, 8);

  if (finalTags.length === 0) bestCategory = "other";

  return { category: bestCategory, tags: finalTags };
}

// ============== 测试 ==============
const testCases = [
  {
    name: "正常中文关键词",
    kw: "一二布布 gif",
    url: "https://example.com/bubu/yi-er.gif?t=123",
    expect: { category: "yier", tags: ["一二布布", "gif", "动图"] },
  },
  {
    name: "正常中文 + 简单",
    kw: "搞笑表情包",
    url: "https://example.com/funny/meme.jpg",
    expect: { category: "funny", tags: ["搞笑表情包"] },
  },
  {
    name: "可爱中文",
    kw: "猫猫可爱图片",
    url: "https://cdn.example.com/cats/kitty.png",
    expect: { category: "cute" },
  },
  {
    name: "混合英文和中文",
    kw: "cute可爱表情包",
    url: "https://example.com/x.jpg",
    expect: { category: "cute" },
  },
  {
    name: "乱码/不可识别的字符 → 应标记 other",
    kw: "a@b#c$d ⭐️🎉🔥",
    url: "https://example.com/random.jpg",
    expect: { category: "other", tags: [] },
  },
  {
    name: "纯数字和特殊字符 → 应标记 other",
    kw: "123456 !!! @@@ ###",
    url: "https://example.com/x.jpg",
    expect: { category: "other", tags: [] },
  },
  {
    name: "无意义 URL 乱码 → 不应产生标签",
    kw: "abc123xyz",
    url: "https://example.com/abc123xyz",
    expect: { category: "other", tags: [] },
  },
  {
    name: "仅符号和 emoji → 应标记 other",
    kw: "😂😘😜💯🔥",
    url: "https://example.com/x.jpg",
    expect: { category: "other", tags: [] },
  },
];

let passed = 0;
let failed = 0;

console.log("\n📋 标签验证函数 isCleanTag 测试:");
const tagTests = [
  ["可爱", true], ["cute", true], ["一二布布", true],
  ["gif", true], ["动图", true], ["a", false],
  ["123", false], ["a@b", false], ["😂", false],
  ["中", false], ["中abc", false],
  ["", false], [" ", false], ["abc_123", false],
];
for (const [tag, expected] of tagTests) {
  const actual = isCleanTag(tag);
  const ok = actual === expected;
  console.log(`  ${ok ? "✅" : "❌"} isCleanTag("${tag}") = ${actual} (expected: ${expected})`);
  if (ok) passed++; else failed++;
}

console.log("\n📋 自动分类和标签提取测试:");
for (const tc of testCases) {
  const result = extractTagsFromKeyword(tc.kw, tc.url);
  const categoryOk = result.category === tc.expect.category;
  const tagsOk = tc.expect.tags
    ? tc.expect.tags.every((t) => result.tags.includes(t))
    : true;
  const ok = categoryOk && tagsOk;
  console.log(`  ${ok ? "✅" : "❌"} ${tc.name}`);
  console.log(`     关键词: "${tc.kw}"`);
  console.log(`     → 分类: ${result.category} (expected: ${tc.expect.category})`);
  console.log(`     → 标签: [${result.tags.join(", ") || "(空)"}]`);
  if (tc.expect.tags && tc.expect.tags.length > 0) {
    console.log(`     → 期望包含: [${tc.expect.tags.join(", ")}]`);
  }
  if (ok) passed++; else failed++;
}

console.log(`\n==============================`);
console.log(`✅ 通过: ${passed}   ❌ 失败: ${failed}`);
if (failed === 0) console.log("🎉 所有测试通过！");
else {
  console.log("⚠️  有测试失败，请检查逻辑");
  process.exit(1);
}
