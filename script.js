// extension_ids.json is exported from extension_ids.py for browser use.
const STATUS = {
  extensions: document.getElementById("total-count"),
  scanned: document.getElementById("scanned-count"),
  detected: document.getElementById("detected-count"),
  message: document.getElementById("status-message"),
  progressBar: document.getElementById("scan-progress-bar"),
  progressLabel: document.getElementById("scan-progress-label"),
};

const resultsBody = document.getElementById("results-body");
const DETECTION_TIMEOUT_MS = 2500;
const CONCURRENCY_LIMIT = 12;
const BATCH_DELAY_MS = 80;
let placeholderCleared = false;

const updateStatus = ({ scanned, detected, total, message }) => {
  if (typeof total === "number") {
    STATUS.extensions.textContent = total.toLocaleString();
  }
  if (typeof scanned === "number") {
    STATUS.scanned.textContent = scanned.toLocaleString();
  }
  if (typeof detected === "number") {
    STATUS.detected.textContent = detected.toLocaleString();
  }
  if (typeof scanned === "number" && typeof total === "number") {
    const percent = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;
    STATUS.progressBar.style.width = `${percent}%`;
    STATUS.progressBar.setAttribute("aria-valuenow", `${percent}`);
    STATUS.progressLabel.textContent = `${percent}%`;
  }
  if (message) {
    STATUS.message.textContent = message;
  }
};

const createStatusPill = (label, variant) => {
  const pill = document.createElement("span");
  pill.className = `status-pill ${variant}`;
  pill.textContent = label;
  return pill;
};

const createCell = (text) => {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
};

const createLinkCell = (label, url) => {
  const cell = document.createElement("td");
  const link = document.createElement("a");
  link.href = url;
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noopener";
  cell.appendChild(link);
  return cell;
};

const renderMatch = (extension, metadata) => {
  const row = document.createElement("tr");
  row.appendChild(createCell(extension.id));
  if (metadata?.original_name) {
    row.appendChild(
      createLinkCell(
        metadata.original_name,
        `https://chromewebstore.google.com/detail/${extension.id}`
      )
    );
  } else {
    row.appendChild(createCell("Not in dataset"));
  }
  row.appendChild(createCell(metadata?.extension_category || "Unknown"));
  row.appendChild(createCell(metadata?.overview || "Unknown"));

  const statusCell = document.createElement("td");
  statusCell.appendChild(createStatusPill("Detected", "detected"));
  row.appendChild(statusCell);

  if (!placeholderCleared) {
    const placeholder = resultsBody.querySelector(".placeholder");
    if (placeholder) {
      placeholder.closest("tr").remove();
    }
    placeholderCleared = true;
  }
  resultsBody.appendChild(row);
};

const showError = (message) => {
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = message;
  STATUS.message.appendChild(notice);
};

const loadJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load dataset from ${url}: ${response.status}`);
  }
  return response.json();
};

const probeExtension = (id, path) => {
  const url = `chrome-extension://${id}/${path}`;
  const lowerPath = path.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(lowerPath);

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    timeoutId = setTimeout(() => finish(false), DETECTION_TIMEOUT_MS);

    if (isImage) {
      const image = new Image();
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = url;
      return;
    }

    fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-cache" })
      .then(() => finish(true))
      .catch(() => finish(false));
  });
};

const runQueue = async (items, handler, onProgress) => {
  let resolved = 0;
  for (let start = 0; start < items.length; start += CONCURRENCY_LIMIT) {
    const batch = items.slice(start, start + CONCURRENCY_LIMIT);
    await Promise.allSettled(
      batch.map(async (item) => {
        try {
          await handler(item);
        } catch (error) {
          console.error("Detection error", error);
        } finally {
          resolved += 1;
          onProgress(resolved);
        }
      })
    );
    if (start + CONCURRENCY_LIMIT < items.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
};

const init = async () => {
  try {
    updateStatus({ message: "Loading extension signatures" });
    const [extensions, metadataById] = await Promise.all([
      loadJson("extension_ids.json"),
      loadJson("extensions_metadata.json"),
    ]);
    updateStatus({
      total: extensions.length,
      scanned: 0,
      detected: 0,
      message: "Scanning for installed extensions",
    });

    let detected = 0;
    await runQueue(
      extensions,
      async (extension) => {
        const isDetected = await probeExtension(extension.id, extension.path);
        if (isDetected) {
          detected += 1;
          renderMatch(extension, metadataById[extension.id]);
        }
      },
      (scanned) => updateStatus({ scanned, detected })
    );

    updateStatus({ message: "Scan complete." });
  } catch (error) {
    console.error(error);
    updateStatus({ message: "Unable to complete scan." });
    showError("Double-check that this page is being served by a static web server (e.g. nginx).");
  }
};

init();
