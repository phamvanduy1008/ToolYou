export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}
