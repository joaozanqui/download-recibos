// ── State ──────────────────────────────────────────────────────────────────
let isDownloading = false;
let cancelRequested = false;

const BATCH_SIZE = 8;          // downloads simultâneos por lote (restaurado para velocidade)
const BATCH_DELAY_MS = 150;    // pausa entre lotes (ms)
const REQUEST_TIMEOUT_MS = 20000; // timeout por arquivo (20s)
const MAX_RETRIES = 4;         // tentativas por arquivo antes de desistir
const RETRY_DELAY_MS = 1500;   // espera base entre tentativas (ms)

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
  if (overallCount) overallCount.textContent = `${done} / ${total}`;
  if (overallBar) {
    overallBar.style.width = total > 0 ? `${(done / total) * 100}%` : "0%";
    if (done === total && total > 0) overallBar.classList.add("complete");
  }
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
const IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const LOCAL_PROXY      = "http://localhost:8765/proxy?url=";
// Após fazer o deploy do cloudflare-worker.js, substitua pela sua URL:
const CLOUDFLARE_PROXY = "https://crimson-salad-a927.jpzanqui.workers.dev/?url=";

// Penalização adaptativa por domínio para reduzir 403s sem sacrificar velocidade
const domainPenalty = new Map(); // hostname -> integer penalty
function getHostnameFromUrl(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

async function fetchFileBlob(url) {
  const proxyBase = IS_LOCAL ? LOCAL_PROXY : CLOUDFLARE_PROXY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(proxyBase + encodeURIComponent(url), { signal: controller.signal });
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      // include status code/text at start to help detection
      throw new Error(`${response.status} ${response.statusText}: ${errText}`);
    }
    const resolvedName = extractFilename(response, url, null);
    const blob = await response.blob();
    return { blob, resolvedName };
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timeout após ${REQUEST_TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url) {
  let lastErr;
  const domain = getHostnameFromUrl(url);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // small pre-delay based on domain penalty to spread retries without lowering global concurrency
      const penalty = domain ? (domainPenalty.get(domain) || 0) : 0;
      if (penalty > 0) {
        const preDelay = Math.min(800 * penalty, 3000) + Math.floor(Math.random() * 300);
        await sleep(preDelay);
      } else {
        // tiny jitter to avoid perfectly synchronized bursts
        await sleep(Math.floor(Math.random() * 80));
      }

      const result = await fetchFileBlob(url);

      // on success, gently reduce domain penalty
      if (domain) domainPenalty.set(domain, Math.max(0, (domainPenalty.get(domain) || 0) - 1));
      return result;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || "");
      const is403 = msg.indexOf('403') !== -1 || msg.toLowerCase().includes('forbidden');

      if (is403 && domain) {
        const prev = domainPenalty.get(domain) || 0;
        domainPenalty.set(domain, prev + 1);
      }

      if (attempt < MAX_RETRIES && !cancelRequested) {
        const baseDelay = RETRY_DELAY_MS * attempt;
        const jitter = Math.floor(Math.random() * 800);
        let extraPause = 0;
        if (is403 && domain) {
          const pen = domainPenalty.get(domain) || 0;
          extraPause = Math.min(pen * 1500, 10000);
        }
        await sleep(baseDelay + jitter + extraPause);
      }
    }
  }
  throw lastErr;
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

    const totalBatches = Math.ceil(cat.links.length / BATCH_SIZE);

    for (let i = 0; i < cat.links.length; i += BATCH_SIZE) {
      if (cancelRequested) break;

      const batchUrls  = cat.links.slice(i, i + BATCH_SIZE);
      const batchNum   = Math.floor(i / BATCH_SIZE) + 1;

      setCurrentFile(
        cat.name,
        Math.min(i + batchUrls.length, cat.links.length),
        cat.links.length,
        `lote ${batchNum}/${totalBatches} (${batchUrls.length} arquivo(s))`
      );

      const results = await Promise.allSettled(
        batchUrls.map((url) => fetchWithRetry(url))
      );

      for (let j = 0; j < results.length; j++) {
        const index        = i + j;
        const prefix       = String(index + 1).padStart(4, "0");
        const fallbackName = `${prefix}_recibo.pdf`;

        if (results[j].status === "fulfilled") {
          const { blob, resolvedName } = results[j].value;
          const baseName = resolvedName ?? "recibo.pdf";
          const filename = `${prefix}_${baseName}`;
          catZipFolder.file(filename, blob);
          appendLog(cat.name, filename, "ok");
        } else {
          totalErrors++;
          appendLog(cat.name, fallbackName, "error",
            `Falhou após ${MAX_RETRIES} tentativas: ${results[j].reason?.message}`);
        }

        overallDone++;
        updateOverallProgress(overallDone, totalLinks);
        updateCategoryProgress(cat.id, index + 1, cat.links.length);
      }

      if (i + BATCH_SIZE < cat.links.length && !cancelRequested) {
        // add a small random jitter between batches to avoid very regular traffic patterns
        await sleep(BATCH_DELAY_MS + Math.floor(Math.random() * 400));
      }
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
