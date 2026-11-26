import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { preferLocalImages, visualRequest, type VisualMatch } from "@/lib/visual";

type Scene = { id: string; subtitle: string; duration: number; background: string; image: string };
type Draft = { title: string; story: string; ratio: string; scenes: Scene[] };
type Candidate = { id: string; title: string; image_url: string; description?: string };
const newScene = (): Scene => ({ id: crypto.randomUUID(), subtitle: "", duration: 3, background: "#f4e7ed", image: "" });
const initial = (): Draft => ({ title: "我的短剧", story: "", ratio: "9 / 16", scenes: [newScene()] });

export function StoryEditor() {
  const [draft, setDraft] = useState<Draft>(() => {
    try { return JSON.parse(localStorage.getItem("yy-story-draft") || "null") || initial(); }
    catch { return initial(); }
  });
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchMessage, setMatchMessage] = useState("");
  const [page, setPage] = useState(0);
  const [activeSearch, setActiveSearch] = useState("");
  const [semanticResults, setSemanticResults] = useState(false);
  const scene = draft.scenes[selected] || draft.scenes[0];
  useEffect(() => { try { localStorage.setItem("yy-story-draft", JSON.stringify(draft)); } catch { setMessage("草稿保存失败：浏览器存储空间不足，请缩小素材或使用图片链接。"); } }, [draft]);
  const updateScene = (changes: Partial<Scene>) => setDraft(d => ({ ...d, scenes: d.scenes.map((s, i) => i === selected ? { ...s, ...changes } : s) }));
  const move = (delta: number) => {
    const next = selected + delta;
    if (next < 0 || next >= draft.scenes.length) return;
    const scenes = [...draft.scenes]; [scenes[selected], scenes[next]] = [scenes[next], scenes[selected]];
    setDraft({ ...draft, scenes }); setSelected(next);
  };
  const findCandidates = async (query: string, nextPage = 0) => {
    if (!isSupabaseConfigured) { setMatchMessage("请先配置表情库连接，或手动上传素材。"); return; }
    setMatchBusy(true); setMatchMessage("");
    try {
      let request = supabase.from("memes_with_tags").select("id,title,image_url,tags").order("created_at", { ascending: false }).range(nextPage * 24, nextPage * 24 + 23);
      if (query.trim()) request = request.ilike("title", `%${query.trim().replace(/[%_\\]/g, "\\$&")}%`);
      const { data, error } = await request;
      if (error) throw error;
      setCandidates(await preferLocalImages(data || [])); setPage(nextPage); setActiveSearch(query); setSemanticResults(false);
      setMatchMessage(data?.length ? "已按标题搜索，点击素材即可替换。" : "没有找到素材，请换关键词、浏览全部或手动上传。");
    } catch (error) { setMatchMessage(error instanceof Error ? `搜索失败：${error.message}` : "搜索失败，请检查表情库连接。"); }
    finally { setMatchBusy(false); }
  };
  async function findByDescription(query: string) {
    if (!query.trim() || matchBusy) return;
    setMatchBusy(true);
    setMatchMessage("正在按画面描述找图…");
    try {
      const { results } = await visualRequest<{ results: VisualMatch[] }>("search", { query });
      setCandidates(await preferLocalImages(results));
      setSemanticResults(true);
      setMatchMessage(results.length
        ? "按识图描述排序。请确认候选的角色和动作是否合适。"
        : "没有可用的语义索引。请先在表情包库点击「识别已有素材」，也可以按标题搜索。");
    } catch (error) {
      setMatchMessage(error instanceof Error ? error.message : "语义找图失败");
    } finally {
      setMatchBusy(false);
    }
  }
  const generate = async () => {
    if (!draft.story.trim()) { setMessage("请先输入故事内容。"); return; }
    setBusy(true); setMessage("");
    try {
      const tagsResult = isSupabaseConfigured ? await supabase.from("tags").select("name").limit(500) : { data: [], error: null };
      if (tagsResult.error) throw new Error(`读取标签失败：${tagsResult.error.message}`);
      const tags = (tagsResult.data || []).map(t => t.name);
      const response = await fetch("/ollama/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen2.5:7b", stream: false, format: "json", messages: [{ role: "user", content: `将以下故事拆成 2 到 8 个短视频分镜。只输出 JSON：{"scenes":[{"subtitle":"简短字幕","duration":3,"tag":"最贴切的已有标签或空字符串"}]}。每个时长 1 至 10 秒。只能从以下已有标签中选择，不匹配则返回空字符串：${JSON.stringify(tags)}。故事：${draft.story}` }] }) });
      if (!response.ok) throw new Error(`Ollama 请求失败 (${response.status})`);
      const result = await response.json();
      const parsed = JSON.parse(result.message.content);
      if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) throw new Error("模型没有返回有效分镜，请重试。");
      const scenes: Scene[] = [];
      for (const item of parsed.scenes.slice(0, 8)) {
        let image = "";
        if (typeof item.tag === "string" && tags.includes(item.tag)) {
          const { data, error } = await supabase.from("memes_with_tags").select("id,image_url").filter("tags", "cs", `{"${item.tag.replace(/"/g, '\\"')}"}`).limit(1);
          if (error) throw error;
          image = (await preferLocalImages(data || []))[0]?.image_url || "";
        }
        scenes.push({ ...newScene(), subtitle: String(item.subtitle || ""), duration: Math.min(10, Math.max(1, Number(item.duration) || 3)), image });
      }
      setDraft(d => ({ ...d, scenes })); setSelected(0);
      setMessage(`已生成 ${scenes.length} 个分镜；${scenes.filter(s => !s.image).length} 个未匹配素材，请手动上传或填写链接。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "生成失败，请检查 Ollama 服务。"); }
    finally { setBusy(false); }
  };
  return <main className="max-w-7xl mx-auto p-4 sm:p-6">
    <div className="flex flex-wrap justify-between items-center gap-3 mb-6"><div><h1 className="text-2xl font-semibold">短剧工作台</h1><p className="text-sm text-gray-500 mt-1">草稿自动保存在当前浏览器</p></div><span className="text-sm text-gray-500">本地模型 qwen2.5:7b</span></div>
    <div className="grid lg:grid-cols-[280px_1fr_300px] gap-5 items-start">
      <section className="border rounded-lg p-4 space-y-4"><h2 className="font-semibold">故事与分镜</h2>
        <label className="block text-sm">项目名称<input className="w-full border rounded p-2 mt-1" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
        <label className="block text-sm">故事<textarea className="w-full border rounded p-2 mt-1" rows={4} placeholder="写下故事梗概或对话" value={draft.story} onChange={e => setDraft({ ...draft, story: e.target.value })}/></label>
        <button className="w-full bg-black text-white rounded p-2 disabled:opacity-50" disabled={busy} onClick={generate}>{busy ? "正在生成分镜…" : "AI 生成分镜并匹配素材"}</button>
        {message && <p role="status" className="text-sm">{message}</p>}
        <div className="space-y-2">{draft.scenes.map((s, i) => <button key={s.id} onClick={() => setSelected(i)} className={`block w-full text-left p-3 rounded border ${selected === i ? "border-black bg-gray-100" : "border-gray-200"}`}><span className="font-medium">镜头 {i + 1}</span><span className="float-right text-sm text-gray-500">{s.duration} 秒</span><p className="text-sm text-gray-500 truncate mt-1">{s.subtitle || "添加字幕"}</p></button>)}</div>
        <button className="w-full border rounded p-2" onClick={() => { setDraft({ ...draft, scenes: [...draft.scenes, newScene()] }); setSelected(draft.scenes.length); }}>＋ 添加镜头</button>
      </section>
      <section className="bg-gray-100 rounded-lg p-5"><div className="flex justify-between mb-4"><h2 className="font-semibold">画面预览</h2><span className="text-sm text-gray-500">镜头 {selected + 1}</span></div><div className="mx-auto relative overflow-hidden flex items-center justify-center" style={{ aspectRatio: draft.ratio, background: scene.background, maxHeight: 500, maxWidth: "100%" }}>{scene.image && <img src={scene.image} alt="分镜素材" className="max-h-full max-w-full object-contain"/>}<div className="absolute bottom-4 left-3 right-3 text-center text-white font-bold" style={{ textShadow: "1px 1px 3px #000, -1px -1px 3px #000" }}>{scene.subtitle}</div></div></section>
      <section className="border rounded-lg p-4 space-y-4"><h2 className="font-semibold">镜头设置</h2>
        <label className="block text-sm">画幅<select className="w-full border rounded p-2 mt-1" value={draft.ratio} onChange={e => setDraft({ ...draft, ratio: e.target.value })}><option value="9 / 16">竖屏 9:16</option><option value="16 / 9">横屏 16:9</option><option value="1 / 1">方形 1:1</option></select></label>
        <label className="block text-sm">字幕<textarea className="w-full border rounded p-2 mt-1" rows={3} value={scene.subtitle} onChange={e => updateScene({ subtitle: e.target.value })}/></label>
        <label className="block text-sm">时长（秒）<input type="number" min="0.5" max="60" step="0.5" className="w-full border rounded p-2 mt-1" value={scene.duration} onChange={e => updateScene({ duration: Math.max(0.5, Number(e.target.value)) })}/></label>
        <label className="block text-sm">背景颜色<input type="color" className="block mt-1" value={scene.background} onChange={e => updateScene({ background: e.target.value })}/></label>
        <label className="block text-sm">图片或 GIF 链接<input className="w-full border rounded p-2 mt-1" placeholder="https://..." value={scene.image} onChange={e => updateScene({ image: e.target.value })}/></label>
        <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold">重新匹配当前镜头</h3>
        <label className="block text-sm">关键词或画面描述
          <input className="mt-1 w-full rounded border p-2" placeholder="例如：小熊紧张地藏起鸡腿"
            value={search} maxLength={500} onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); void findByDescription(search.trim() || scene.subtitle); }
            }} />
        </label>
        <button className="w-full rounded border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          disabled={matchBusy || !(search.trim() || scene.subtitle.trim())}
          onClick={() => void findByDescription(search.trim() || scene.subtitle)}>
          {search.trim() ? "按输入描述语义找图" : "按当前字幕语义找图"}
        </button>
        <div className="flex gap-2">
          <button className="rounded border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            disabled={matchBusy || !search.trim()} onClick={() => void findCandidates(search)}>按标题搜索</button>
          <button className="rounded border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            disabled={matchBusy} onClick={() => { setSearch(""); void findCandidates(""); }}>浏览全部</button>
        </div>
        {matchMessage && <p role="status" className="text-sm text-gray-600">{matchMessage}</p>}
        {candidates.length > 0 && <>
          <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
            {candidates.map(candidate => (
              <button key={candidate.id} className={`min-w-0 rounded border p-1 text-left hover:bg-muted ${scene.image === candidate.image_url ? "border-black" : "border-gray-200"}`}
                aria-pressed={scene.image === candidate.image_url} title={candidate.description || candidate.title}
                onClick={() => { updateScene({ image: candidate.image_url }); setMatchMessage("已替换当前镜头素材。"); }}>
                <img src={candidate.image_url} alt="" className="aspect-square w-full bg-gray-100 object-contain" loading="lazy" referrerPolicy="no-referrer" />
                <span className="mt-1 block line-clamp-2 text-xs">{candidate.description || candidate.title}</span>
              </button>
            ))}
          </div>
          {!semanticResults && <div className="flex gap-2">
            <button className="text-sm underline disabled:opacity-40" disabled={matchBusy || page === 0}
              onClick={() => void findCandidates(activeSearch, page - 1)}>上一页</button>
            <button className="text-sm underline disabled:opacity-40" disabled={matchBusy || candidates.length < 24}
              onClick={() => void findCandidates(activeSearch, page + 1)}>下一页</button>
          </div>}
        </>}
        </div>
        <label className="block text-sm">上传图片或 GIF<input type="file" accept="image/*" className="block w-full mt-1 text-sm" onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => updateScene({ image: String(reader.result) }); reader.readAsDataURL(file); }}/></label>
        <div className="flex gap-2"><button className="border rounded px-3 py-2" onClick={() => move(-1)}>上移</button><button className="border rounded px-3 py-2" onClick={() => move(1)}>下移</button><button className="border rounded px-3 py-2 text-red-700" disabled={draft.scenes.length === 1} onClick={() => { setDraft({ ...draft, scenes: draft.scenes.filter((_, i) => i !== selected) }); setSelected(Math.max(0, selected - 1)); }}>删除</button></div>
        <p className="text-sm text-gray-500">当前为编辑器基础版本，视频导出和音乐功能尚未接入。</p>
      </section>
    </div>
  </main>;
}
