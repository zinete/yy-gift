export type VisualMatch = {
  id: string;
  title: string;
  image_url: string;
  description: string;
  score: number;
};

export async function visualRequest<T>(action: string, input?: object): Promise<T> {
  const response = await fetch(`/api/visual/${action}`, input && {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("本地识图接口不可用，请使用项目的 Vite 服务");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "本地识图请求失败");
  return result as T;
}

export async function preferLocalImages<T extends { id: string; image_url: string }>(rows: T[]): Promise<T[]> {
  const cloudPrefix = `${(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "")}/storage/v1/object/public/yy-meme-originals/`;
  const legacyRows = rows.filter(row => !row.image_url.startsWith(cloudPrefix));
  if (legacyRows.length === 0) return rows;
  try {
    const { assets } = await visualRequest<{ assets: Record<string, string> }>("assets", {
      ids: legacyRows.map(row => row.id),
    });
    return rows.map(row => assets[row.id] ? { ...row, image_url: assets[row.id] } : row);
  } catch {
    // The library can also be opened from a static build without the local service.
    return rows;
  }
}
