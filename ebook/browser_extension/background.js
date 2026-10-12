const STATE_KEY = "crawlState";
let processing = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanUrl = (url) => String(url || "").split("#")[0].replace(/\/$/, "");

function parseCategoryUrl(rawUrl) {
  const url = new URL(cleanUrl(rawUrl));
  if (url.protocol !== "https:" || url.hostname !== "dtv-ebook.com.vn") return null;
  const match = url.pathname.match(/^\/(.+)-(\d+)\.html$/);
  if (!match) return null;
  return {
    categoryUrl: `${url.origin}/${match[1]}-${match[2]}.html`,
    origin: url.origin,
    slug: match[1],
    categoryId: match[2],
    basePath: `/${match[1]}-${match[2]}`,
  };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function fail(message) {
  const { crawlState } = await chrome.storage.local.get(STATE_KEY);
  if (!crawlState) return;
  crawlState.running = false;
  crawlState.status = `[FAILED] ${message}`;
  await saveState(crawlState);
}

function extractCategoryCards() {
  const bodyText = document.body?.innerText || "";
  const challenge = document.title.includes("Just a moment")
    || bodyText.includes("Thực hiện xác minh bảo mật")
    || bodyText.includes("Verify you are human")
    || Boolean(document.querySelector("#challenge-running, .cf-challenge-running"));
  const cards = [];
  const localSeen = new Set();
  for (const titleNode of document.querySelectorAll(".noi_dung li.itemtruyen h2.tensanpham")) {
    const anchor = titleNode.closest("a[href]");
    if (!anchor) continue;
    const url = new URL(anchor.getAttribute("href"), location.href).href;
    if (!/^https:\/\/dtv-ebook\.com\.vn\/.*_\d+\.html$/.test(url) || localSeen.has(url)) continue;
    localSeen.add(url);
    cards.push({ title: titleNode.textContent.trim(), url });
  }
  return { challenge, cards };
}

function extractDetailHtml() {
  const bodyText = document.body?.innerText || "";
  const challenge = document.title.includes("Just a moment")
    || bodyText.includes("Thực hiện xác minh bảo mật")
    || bodyText.includes("Verify you are human")
    || Boolean(document.querySelector("#challenge-running, .cf-challenge-running"));
  const pageTitle = document.querySelector("h1")?.textContent?.trim()
    || document.title.replace(/\s*[-|].*$/, "").trim();
  return { challenge, html: document.documentElement.outerHTML, pageTitle };
}

async function execute(tabId, func) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func });
  if (!results?.length) throw new Error("Không đọc được nội dung tab Chrome");
  return results[0].result;
}

async function navigate(state, url, mode, status, currentCard = null) {
  state.mode = mode;
  state.expectedUrl = cleanUrl(url);
  state.currentCard = mode === "detail" ? currentCard : null;
  state.status = status;
  await saveState(state);
  await wait(3_000 + Math.random() * 2_000);
  await chrome.tabs.update(state.tabId, { url });
}

async function finish(state) {
  state.running = false;
  state.status = `[DONE] Đã thu thập ${state.detailKeys.length} truyện. Đang tạo JSON…`;
  await saveState(state);
  await chrome.tabs.create({ url: chrome.runtime.getURL("export.html"), active: true });
}

async function processLoadedTab(tabId, tabUrl) {
  if (processing) return;
  processing = true;
  try {
    const { crawlState: state } = await chrome.storage.local.get(STATE_KEY);
    if (!state?.running || state.tabId !== tabId) return;
    if (cleanUrl(tabUrl) !== state.expectedUrl) return;

    if (state.mode === "category") {
      const snapshot = await execute(tabId, extractCategoryCards);
      if (snapshot.challenge) {
        state.status = "[WAIT] Hãy hoàn tất xác minh Cloudflare trong tab crawler; extension sẽ tự tiếp tục.";
        await saveState(state);
        return;
      }
      const cards = snapshot.cards;
      if (!cards.length) {
        if (state.page === 1 && !state.detailKeys.length) {
          throw new Error("Trang đầu không có truyện hoặc vẫn bị chặn");
        }
        await finish(state);
        return;
      }
      const seen = new Set(state.seen);
      const fresh = cards.filter((card) => {
        if (seen.has(card.url)) return false;
        seen.add(card.url);
        return true;
      });
      if (!fresh.length) {
        state.page += 1;
        const nextPage = `${state.origin}${state.basePath}/${state.page}.html`;
        await navigate(state, nextPage, "category", `[PAGE ${state.page}] Bỏ qua trang đã nhập`);
        return;
      }
      state.seen = [...seen];
      state.queue = fresh;
      state.status = `[PAGE ${state.page}] Tìm thấy ${fresh.length} truyện mới`;
      await saveState(state);
      const card = state.queue[0];
      await navigate(
        state,
        card.url,
        "detail",
        `[DETAIL ${state.detailKeys.length + 1}] ${card.title}`,
        card,
      );
      return;
    }

    if (state.mode === "detail") {
      const normalizedTabUrl = cleanUrl(tabUrl);
      let card = state.queue[0];
      let queueIndex = card && cleanUrl(card.url) === normalizedTabUrl ? 0 : -1;
      if (queueIndex < 0) {
        queueIndex = state.queue.findIndex((item) => cleanUrl(item.url) === normalizedTabUrl);
        card = queueIndex >= 0
          ? state.queue[queueIndex]
          : (cleanUrl(state.currentCard?.url) === normalizedTabUrl ? state.currentCard : null);
      }
      // Phiên tạo bởi bản cũ có thể đã shift card trước khi gặp Cloudflare.
      // Giữ URL hiện tại để cứu phiên; tiêu đề sẽ được lấy từ chính trang chi tiết.
      if (!card && cleanUrl(state.expectedUrl) === normalizedTabUrl) {
        card = { title: "", url: tabUrl };
      }
      if (!card) throw new Error("Không thể khôi phục trang chi tiết hiện tại từ hàng đợi");
      const snapshot = await execute(tabId, extractDetailHtml);
      if (snapshot.challenge) {
        state.status = "[WAIT] Hãy hoàn tất xác minh Cloudflare trong tab crawler; extension sẽ tự tiếp tục.";
        await saveState(state);
        return;
      }
      const html = snapshot.html;
      const key = `detail_${state.runId}_${state.detailKeys.length}`;
      await chrome.storage.local.set({
        [key]: { title: card.title || snapshot.pageTitle || "", url: card.url, html },
      });
      state.detailKeys.push(key);
      if (queueIndex >= 0) state.queue.splice(queueIndex, 1);
      state.currentCard = null;
      await saveState(state);
      if (state.queue.length) {
        const next = state.queue[0];
        await navigate(
          state,
          next.url,
          "detail",
          `[DETAIL ${state.detailKeys.length + 1}] ${next.title}`,
          next,
        );
      } else {
        state.page += 1;
        const nextPage = `${state.origin}${state.basePath}/${state.page}.html`;
        await navigate(state, nextPage, "category", `[PAGE ${state.page}] Đang mở danh mục`);
      }
    }
  } catch (error) {
    await fail(error?.message || String(error));
  } finally {
    processing = false;
  }
}

async function startCrawl(rawUrl) {
  const parsed = parseCategoryUrl(rawUrl);
  if (!parsed) return { error: "Hãy mở đúng trang danh mục DTV trước khi bắt đầu." };
  await chrome.storage.local.clear();
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const state = {
    version: 1,
    runId: Date.now().toString(36),
    running: true,
    tabId: tab.id,
    ...parsed,
    page: 1,
    mode: "category",
    queue: [],
    currentCard: null,
    seen: [],
    detailKeys: [],
    expectedUrl: parsed.categoryUrl,
    status: "[PAGE 1] Đang mở danh mục",
  };
  await saveState(state);
  await chrome.tabs.update(tab.id, { url: parsed.categoryUrl });
  return { ok: true };
}

async function resumeCrawl() {
  const { crawlState: state } = await chrome.storage.local.get(STATE_KEY);
  if (!state) return { error: "Không có phiên crawl cũ để tiếp tục" };
  if (state.running) return { ok: true };
  try {
    await chrome.tabs.get(state.tabId);
  } catch {
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    state.tabId = tab.id;
  }
  state.running = true;
  state.status = `[RESUME] Đang mở lại ${state.expectedUrl}`;
  await saveState(state);
  await chrome.tabs.update(state.tabId, { url: state.expectedUrl, active: true });
  return { ok: true };
}

async function importCrawl(message) {
  const parsed = parseCategoryUrl(message.categoryUrl);
  if (!parsed) return { error: "category_url trong JSON không phải danh mục DTV hợp lệ" };
  if (!Array.isArray(message.detailKeys) || !message.detailKeys.length || !Array.isArray(message.seen)) {
    return { error: "Danh sách dữ liệu import không hợp lệ" };
  }

  const { crawlState: oldState } = await chrome.storage.local.get(STATE_KEY);
  if (oldState?.running) return { error: "Hãy dừng phiên hiện tại trước khi nhập JSON" };
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const state = {
    version: 1,
    runId: String(message.runId || Date.now().toString(36)),
    running: true,
    tabId: tab.id,
    ...parsed,
    page: 1,
    mode: "category",
    queue: [],
    currentCard: null,
    seen: [...new Set(message.seen.map(cleanUrl))],
    detailKeys: message.detailKeys,
    expectedUrl: parsed.categoryUrl,
    status: `[IMPORT] Đã nạp ${message.detailKeys.length} truyện; đang quét phần còn thiếu`,
  };
  await saveState(state);
  await chrome.tabs.update(tab.id, { url: parsed.categoryUrl });
  const obsoleteKeys = (oldState?.detailKeys || []).filter((key) => !state.detailKeys.includes(key));
  if (obsoleteKeys.length) await chrome.storage.local.remove(obsoleteKeys);
  return { ok: true };
}

async function exportCollected() {
  const { crawlState } = await chrome.storage.local.get(STATE_KEY);
  if (!crawlState?.detailKeys?.length) return { error: "Chưa thu thập được truyện nào để xuất" };
  await chrome.tabs.create({ url: chrome.runtime.getURL("export.html"), active: true });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = message?.type === "start"
    ? startCrawl(message.url)
    : message?.type === "resume"
      ? resumeCrawl()
      : message?.type === "import"
        ? importCrawl(message)
      : message?.type === "export"
        ? exportCollected()
    : message?.type === "stop"
      ? (async () => {
          const { crawlState } = await chrome.storage.local.get(STATE_KEY);
          if (crawlState) {
            crawlState.running = false;
            crawlState.status = "Đã dừng theo yêu cầu";
            await saveState(crawlState);
          }
          return { ok: true };
        })()
      : Promise.resolve({ error: "Lệnh không hợp lệ" });
  task.then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) processLoadedTab(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { crawlState } = await chrome.storage.local.get(STATE_KEY);
  if (crawlState?.running && crawlState.tabId === tabId) await fail("Tab crawler đã bị đóng");
});
