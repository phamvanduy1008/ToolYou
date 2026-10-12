export function assertTruyendichUrl(rawUrl: string, baseUrl: string): URL {
  const parsed = new URL(rawUrl);
  const base = new URL(baseUrl);
  if (parsed.hostname !== base.hostname) {
    throw new Error(`URL không thuộc ${base.hostname}: ${rawUrl}`);
  }
  return parsed;
}

export function slugFromUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  return parts.at(-1) ?? "truyen";
}

export function toAbsoluteUrl(href: string, baseUrl: string): string {
  return new URL(href, baseUrl).toString();
}

export function parseChapterNumber(url: string, fallback: number): number {
  const match = url.match(/(?:chuong|chapter)[-/]?(\d+)/i) ?? url.match(/(\d+)(?:\/)?$/);
  return match ? Number(match[1]) : fallback;
}
