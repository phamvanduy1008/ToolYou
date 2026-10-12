export type ChapterStatus = "pending" | "processing" | "completed" | "failed" | "blocked" | "challenge";

export interface StoryMetadata {
  url: string;
  slug: string;
  title: string;
  author?: string;
  status?: string;
  totalChapters?: number;
  coverUrl?: string;
  crawledAt: string;
}

export interface ChapterLink {
  number: number;
  title: string;
  url: string;
}

export interface ParsedChapter {
  number: number;
  title: string;
  url: string;
  content: string;
}

export interface ChapterProgress {
  number: number;
  title: string;
  url: string;
  status: ChapterStatus;
  filePath?: string;
  contentLength?: number;
  retryCount: number;
  errorMessage?: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CrawlProgress {
  story?: StoryMetadata;
  chapters: Record<string, ChapterProgress>;
  lastRun?: {
    startedAt: string;
    stoppedAt?: string;
    status: "running" | "completed" | "stopped" | "failed";
    stopReason?: string;
    lastCompletedChapter?: number;
  };
}
