const current = document.querySelector("#current");
const status = document.querySelector("#status");
const start = document.querySelector("#start");
const resume = document.querySelector("#resume");
const exportButton = document.querySelector("#export");
const importButton = document.querySelector("#import");
const stop = document.querySelector("#stop");
let activeTab = null;

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  current.textContent = tab?.url || "Không xác định được tab hiện tại";
  const { crawlState } = await chrome.storage.local.get("crawlState");
  status.textContent = crawlState?.status || "Sẵn sàng";
  start.disabled = Boolean(crawlState?.running);
  resume.disabled = !crawlState || Boolean(crawlState.running);
  exportButton.disabled = !crawlState?.detailKeys?.length;
  importButton.disabled = Boolean(crawlState?.running);
  stop.disabled = !crawlState?.running;
}

start.addEventListener("click", async () => {
  if (!activeTab?.url) return;
  const result = await chrome.runtime.sendMessage({ type: "start", url: activeTab.url });
  status.textContent = result?.error || "Đang khởi động…";
  await refresh();
});

resume.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "resume" });
  status.textContent = result?.error || "Đang tiếp tục…";
  await refresh();
});

exportButton.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "export" });
  status.textContent = result?.error || "Đang tạo JSON…";
});

importButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("import.html"), active: true });
});

stop.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stop" });
  await refresh();
});

chrome.storage.onChanged.addListener(refresh);
refresh();
