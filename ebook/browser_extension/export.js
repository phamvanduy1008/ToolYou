const status = document.querySelector("#status");
const button = document.querySelector("#download");
let blobUrl = "";

async function prepare() {
  const { crawlState } = await chrome.storage.local.get("crawlState");
  if (!crawlState?.detailKeys?.length) throw new Error("Không có dữ liệu truyện để xuất");
  const stored = await chrome.storage.local.get(crawlState.detailKeys);
  const details = crawlState.detailKeys.map((key) => stored[key]).filter(Boolean);
  const payload = {
    version: 1,
    category_url: crawlState.categoryUrl,
    exported_at: new Date().toISOString(),
    details,
  };
  blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  button.disabled = false;
  button.textContent = `Tải JSON (${details.length} truyện)`;
  status.textContent = `Đã chuẩn bị ${details.length} truyện. File sẽ được tải tự động.`;
  button.click();
}

button.addEventListener("click", () => {
  if (!blobUrl) return;
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = "dtv-browser-export.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
});

prepare().catch((error) => {
  status.textContent = `[FAILED] ${error.message}`;
});
