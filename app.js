// ── State ──────────────────────────────────────────────────────────────────
let isDownloading = false;
let cancelRequested = false;

const DELAY_MS = 250; // delay between each file fetch (ms)

const CATEGORIES = [
  { id: "fmv2",         name: "FM V2",         folder: "FM V2" },
  { id: "fmv2exp",      name: "FM V2 EXP",     folder: "FM V2 EXP" },
  { id: "totalexpress", name: "Total Express",  folder: "Total Express" },
];

// ── DOM refs ────────────────────────────────────────────────────────────────
const downloadBtn     = document.getElementById("downloadBtn");
const cancelBtn       = document.getElementById("cancelBtn");
const statusMessage   = document.getElementById("statusMessage");
const progressSection = document.getElementById("progressSection");
const overallBar      = document.getElementById("overallBar");
const overallCount    = document.getElementById("overallCount");
const currentFileInfo = document.getElementById("currentFileInfo");
const downloadLog     = document.getElementById("downloadLog");
const logEntries      = document.getElementById("logEntries");
const clearLogBtn     = document.getElementById("clearLogBtn");

// ── Utilities ───────────────────────────────────────────────────────────────
function parseLinks(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http://") || l.startsWith("https://"));
}

function getDateTimeString() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  );
}

function extractFilename(response, originalUrl, fallback) {
  // 1. Content-Disposition header (most reliable)
  const cd = response.headers.get("content-disposition");
  if (cd) {
    const utf8 = cd.match(/filename\*=UTF-8''([^;\s]+)/i);
    if (utf8) return decodeURIComponent(utf8[1]);
    const ascii = cd.match(/filename="?([^";\n]+)"?/i);
    if (ascii) return ascii[1].trim();
  }
  // 2. Last path segment of the original URL
  if (originalUrl) {
    try {
      const segment = new URL(originalUrl).pathname.split("/").pop();
      if (segment && segment.includes(".")) return decodeURIComponent(segment);
    } catch {}
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── UI helpers ──────────────────────────────────────────────────────────────
function setStatus(msg, type = "") {
  statusMessage.textContent = msg;
  statusMessage.className = "status-message" + (type ? " " + type : "");
}

function updateLinkCount(id, count) {
  const el = document.getElementById(id + "Count");
  el.textContent = count === 0 ? "0 links" : `${count} links`;
  el.classList.toggle("has-links", count > 0);
}

function updateOverallProgress(done, total) {
  overallCount.textContent = `${done} / ${total}`;
  overallBar.style.width = total > 0 ? `${(done / total) * 100}%` : "0%";
  if (done === total && total > 0) overallBar.classList.add("complete");
}

function updateCategoryProgress(id, done, total) {
  const bar   = document.getElementById(`cat-${id}-bar`);
  const count = document.getElementById(`cat-${id}-count`);
  if (!bar || !count) return;
  count.textContent = total > 0 ? `${done} / ${total}` : "—";
  bar.style.width   = total > 0 ? `${(done / total) * 100}%` : "0%";
  if (done === total && total > 0) bar.classList.add("complete");
}

function resetCategoryProgress(id) {
  const bar   = document.getElementById(`cat-${id}-bar`);
  const count = document.getElementById(`cat-${id}-count`);
  if (bar)   { bar.style.width = "0%"; bar.classList.remove("complete"); }
  if (count) count.textContent = "—";
}

function setCurrentFile(catName, index, total, filename) {
  currentFileInfo.textContent = `[${catName}] ${index}/${total} — ${filename}`;
}

function appendLog(catName, filename, status, errorMsg) {
  const entry = document.createElement("div");
  entry.className = `log-entry ${status}`;
  entry.innerHTML =
    `<span class="log-cat">${catName}</span>` +
    `<span class="log-filename" title="${filename}">${filename}</span>` +
    `<span class="log-status">${status === "ok" ? "OK" : "ERRO"}</span>`;
  if (errorMsg) entry.title = errorMsg;
  logEntries.prepend(entry);

  downloadLog.classList.add("visible");
}

function checkDownloadEnabled() {
  const hasLinks = CATEGORIES.some(
    (c) => parseLinks(document.getElementById(c.id).value).length > 0
  );
  downloadBtn.disabled = !hasLinks || isDownloading;
}

// ── Folder selection ────────────────────────────────────────────────────────
// (removed — downloads now use ZIPs saved via browser)

// ── Cancel ──────────────────────────────────────────────────────────────────
cancelBtn.addEventListener("click", () => {
  cancelRequested = true;
  setStatus("Cancelando...");
});

// ── Clear log ───────────────────────────────────────────────────────────────
clearLogBtn.addEventListener("click", () => {
  logEntries.innerHTML = "";
  downloadLog.classList.remove("visible");
});

// ── Link count on input ─────────────────────────────────────────────────────
CATEGORIES.forEach(({ id }) => {
  document.getElementById(id).addEventListener("input", () => {
    const links = parseLinks(document.getElementById(id).value);
    updateLinkCount(id, links.length);
    checkDownloadEnabled();
  });
});

// ── Core download ────────────────────────────────────────────────────────────
// Fetch via local proxy to bypass CORS restrictions
const PROXY = "http://localhost:8765/proxy?url=";

async function fetchFileBlob(url) {
  const response = await fetch(PROXY + encodeURIComponent(url));
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(errText || `HTTP ${response.status}`);
  }
  const resolvedName = extractFilename(response, url, null);
  const blob = await response.blob();
  return { blob, resolvedName };
}

function triggerZipDownload(zipBlob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}

// ── Main download flow ───────────────────────────────────────────────────────
downloadBtn.addEventListener("click", async () => {
  if (typeof JSZip === "undefined") {
    setStatus("Erro: JSZip não carregado. Verifique sua conexão com a internet.", "error");
    return;
  }

  const categoriesWithLinks = CATEGORIES.map((cat) => ({
    ...cat,
    links: parseLinks(document.getElementById(cat.id).value),
  })).filter((cat) => cat.links.length > 0);

  const totalLinks = categoriesWithLinks.reduce((s, c) => s + c.links.length, 0);
  if (totalLinks === 0) {
    setStatus("Nenhum link válido encontrado nos campos.", "error");
    return;
  }

  // Reset UI
  isDownloading = true;
  cancelRequested = false;
  downloadBtn.disabled = true;
  cancelBtn.style.display = "inline-flex";
  progressSection.classList.add("visible");
  logEntries.innerHTML = "";
  downloadLog.classList.remove("visible");
  currentFileInfo.textContent = "Preparando...";

  CATEGORIES.forEach(({ id }) => resetCategoryProgress(id));
  updateOverallProgress(0, totalLinks);

  const dateStr = getDateTimeString();
  let overallDone = 0;
  let totalErrors = 0;

  const zip = new JSZip();

  for (const cat of categoriesWithLinks) {
    if (cancelRequested) break;

    const catZipFolder = zip.folder(cat.folder);

    updateCategoryProgress(cat.id, 0, cat.links.length);

    for (let i = 0; i < cat.links.length; i++) {
      if (cancelRequested) break;

      const url = cat.links[i];
      const prefix = String(i + 1).padStart(4, "0");
      const fallbackName = `${prefix}_recibo.pdf`;

      setCurrentFile(cat.name, i + 1, cat.links.length, fallbackName);

      try {
        const { blob, resolvedName } = await fetchFileBlob(url);
        const baseName = resolvedName ?? "recibo.pdf";
        const filename = `${prefix}_${baseName}`;
        catZipFolder.file(filename, blob);
        appendLog(cat.name, filename, "ok");
      } catch (err) {
        totalErrors++;
        appendLog(cat.name, fallbackName, "error", err.message);
      }

      overallDone++;
      updateOverallProgress(overallDone, totalLinks);
      updateCategoryProgress(cat.id, i + 1, cat.links.length);

      await sleep(DELAY_MS);
    }
  }

  // Generate and download single ZIP with all categories
  if (!cancelRequested) {
    currentFileInfo.textContent = "Gerando ZIP...";
    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      triggerZipDownload(zipBlob, `Recibos_${dateStr}.zip`);
    } catch (err) {
      setStatus(`Erro ao gerar ZIP: ${err.message}`, "error");
    }
  }

  // Finished
  isDownloading = false;
  downloadBtn.disabled = false;
  cancelBtn.style.display = "none";
  currentFileInfo.textContent = cancelRequested ? "Download cancelado." : "Concluído.";

  if (cancelRequested) {
    setStatus(`Download cancelado. ${overallDone} arquivo(s) processado(s).`);
  } else if (totalErrors === 0) {
    setStatus(
      `Concluído! ${overallDone} arquivo(s) em Recibos_${dateStr}.zip — verifique sua pasta Downloads.`,
      "success"
    );
  } else {
    setStatus(
      `Concluído com ${totalErrors} erro(s). ${overallDone - totalErrors} arquivo(s) salvos nos ZIPs.`
    );
  }
});
