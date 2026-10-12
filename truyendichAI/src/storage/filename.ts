import { normalizeWhitespace } from "../utils/text.js";

const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

export function safeSegment(value: string, fallback = "untitled", maxLength = 90): string {
  const cleaned = normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(WINDOWS_FORBIDDEN, "")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return (cleaned || fallback).slice(0, maxLength);
}

export function chapterFileName(number: number, _title: string): string {
  return `${number}.txt`;
}
