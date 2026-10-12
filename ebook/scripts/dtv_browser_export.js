/* Chạy trong DevTools Console trên trang danh mục DTV đã được phép crawl. */
(async () => {
  "use strict";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const categoryUrl = location.href.split("#")[0].replace(/\/$/, "");
  const parsed = new URL(categoryUrl);
  const categoryMatch = parsed.pathname.match(/^\/(.+)-(\d+)(?:\/\d+)?\.html$/);
  if (!categoryMatch) throw new Error("Hãy mở đúng trang danh mục DTV trước khi chạy script.");

  const [, slug, categoryId] = categoryMatch;
  const basePath = `/${slug}-${categoryId}`;
  const details = [];
  const seen = new Set();
  const crawlerWindow = window.open("about:blank", "dtvCrawlerWindow", "width=1100,height=800");
  if (!crawlerWindow) {
    throw new Error("Chrome đã chặn cửa sổ crawler. Hãy cho phép pop-up cho dtv-ebook.com.vn rồi chạy lại.");
  }

  async function fetchHtml(url) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      crawlerWindow.location.replace(url);
      const poll = setInterval(() => {
        try {
          if (crawlerWindow.closed) {
            clearInterval(poll);
            reject(new Error("Cửa sổ crawler đã bị đóng."));
            return;
          }
          const current = crawlerWindow.location.href.split("#")[0];
          const ready = crawlerWindow.document.readyState === "complete";
          if (current === url && ready) {
            clearInterval(poll);
            resolve(crawlerWindow.document.documentElement.outerHTML);
            return;
          }
          if (Date.now() - started > 60_000) {
            clearInterval(poll);
            reject(new Error(`Quá thời gian mở trang: ${url}`));
          }
        } catch {
          if (Date.now() - started > 60_000) {
            clearInterval(poll);
            reject(new Error(`Không đọc được cửa sổ crawler: ${url}`));
          }
        }
      }, 250);
    });
  }

  function cardsFrom(html, pageUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const cards = [];
    for (const titleNode of doc.querySelectorAll(".noi_dung li.itemtruyen h2.tensanpham")) {
      const anchor = titleNode.closest("a[href]");
      if (!anchor) continue;
      const url = new URL(anchor.getAttribute("href"), pageUrl).href;
      if (!/^https:\/\/dtv-ebook\.com\.vn\/.*_\d+\.html$/.test(url)) continue;
      cards.push({ title: titleNode.textContent.trim(), url });
    }
    return cards;
  }

  async function fetchDetails(cards) {
    for (const card of cards) {
      await delay(750 + Math.random() * 750);
      console.log(`[DETAIL ${details.length + 1}] ${card.title}`);
      details.push({ ...card, html: await fetchHtml(card.url) });
    }
  }

  for (let page = 1; page <= 1000; page += 1) {
    const pageUrl = `${parsed.origin}${basePath}${page === 1 ? ".html" : `/${page}.html`}`;
    console.log(`[PAGE ${page}] ${pageUrl}`);
    const fresh = cardsFrom(await fetchHtml(pageUrl), pageUrl).filter((card) => {
      if (seen.has(card.url)) return false;
      seen.add(card.url);
      return true;
    });
    if (!fresh.length) {
      if (page === 1) throw new Error("Trang đầu không có truyện; cửa sổ điều hướng có thể vẫn bị chặn.");
      break;
    }
    await fetchDetails(fresh);
  }

  const payload = {
    version: 1,
    category_url: `${parsed.origin}${basePath}.html`,
    exported_at: new Date().toISOString(),
    details,
  };
  const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), {
    href: blobUrl,
    download: `dtv-${slug}-export.json`,
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
  crawlerWindow.close();
  console.log(`[DONE] Đã xuất ${details.length} truyện.`);
})().catch((error) => console.error("[FAILED]", error));
