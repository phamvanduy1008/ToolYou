module.exports = {
  baseUrl: process.env.BASE_URL || "https://lacatruyen.vip",

  novelSlug: process.env.NOVEL_SLUG || "Không Có Tiền Tu Cái Gì Tiên?",
  novelTitle: process.env.NOVEL_TITLE || "khong-co-tien-tu-cai-gi-tien",
  author: process.env.AUTHOR || "Nguyễn Thụy Pháp Tạc",

  // Trang seed nên là một trang chương có __NEXT_DATA__. Có thể override:
  // START_URL="https://lacatruyen.vip/chapter/slug-that-dang-dung" npm start
  startUrl: process.env.START_URL || "https://lacatruyen.world/chapter/Chuong-1-Phong-van-9241",

  // Chỉ dùng khi không parse được danh sách chương từ props.pageProps.chapter.rs.
  chapterUrlPattern: process.env.CHAPTER_URL_PATTERN ,
  expectedChapterCount: Number(process.env.EXPECTED_CHAPTER_COUNT || 726),

  outputDir: process.env.OUTPUT_DIR || "novels/khong-co-tien-tu-cai-gi-tien",
  chaptersPerFile: Number(process.env.CHAPTERS_PER_FILE || 150),
  overwrite: process.env.OVERWRITE === "1",

  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  retries: Number(process.env.RETRIES || 3),
  retryBaseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS || 1200),
  delayMs: Number(process.env.DELAY_MS || 900),
  continueOnError: process.env.CONTINUE_ON_ERROR !== "0" && process.env.CONTINUE_ON_ERROR !== "false",

  // Nếu key không tự dò được từ JS chunk, đặt biến môi trường này.
  decryptKey: process.env.DECRYPT_KEY || "",

  // Cookie đăng nhập nếu cần lấy nội dung không public.
  cookie: process.env.COOKIE || ""
};
