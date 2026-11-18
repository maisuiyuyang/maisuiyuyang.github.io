import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const params = new URLSearchParams(location.search);
const requestedFile = params.get("file") || "article.pdf";

const stage = document.getElementById("stage");
const canvas = document.getElementById("pdf-canvas");
const context = canvas.getContext("2d", { alpha: false });
const message = document.getElementById("message");
const currentPageLabel = document.getElementById("current-page");
const totalPagesLabel = document.getElementById("total-pages");
const zoomLabel = document.getElementById("zoom-level");
const prevButton = document.getElementById("prev-page");
const nextButton = document.getElementById("next-page");
const pageIndexButton = document.getElementById("page-index");
const pageJump = document.getElementById("page-jump");
const pageInput = document.getElementById("page-input");

let pdfDocument = null;
let currentPage = 1;
let zoom = 1;                 // Multiplier over fit-to-view width.
let renderGeneration = 0;
let activeRenderTask = null;
let resizeTimer = null;
let pageAspect = 1;

function showMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
  message.hidden = !text;
  canvas.style.display = text ? "none" : "block";
}

function updateControls() {
  currentPageLabel.textContent = String(currentPage);
  totalPagesLabel.textContent = pdfDocument ? String(pdfDocument.numPages) : "—";
  prevButton.disabled = !pdfDocument || currentPage <= 1;
  nextButton.disabled = !pdfDocument || currentPage >= pdfDocument.numPages;
  zoomLabel.textContent = zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
}

function calculateScale(page) {
  const viewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(220, stage.clientWidth - 28);
  const availableHeight = Math.max(220, stage.clientHeight - 36);

  // Fit the page into the available area initially. Zoom then scales from
  // the PDF's original vector page, never from a previously rendered bitmap.
  const fitScale = Math.min(
    availableWidth / viewport.width,
    availableHeight / viewport.height,
    1.5
  );
  return fitScale * zoom;
}

async function renderCurrentPage() {
  if (!pdfDocument) return;

  const generation = ++renderGeneration;

  if (activeRenderTask) {
    try { activeRenderTask.cancel(); } catch {}
    try { await activeRenderTask.promise; } catch {}
    activeRenderTask = null;
  }
  if (generation !== renderGeneration) return;

  showMessage("Rendering page…");

  try {
    const page = await pdfDocument.getPage(currentPage);
    if (generation !== renderGeneration) return;

    const scale = calculateScale(page);
    const viewport = page.getViewport({ scale });

    // Render at the actual device pixel ratio for crisp text. A pixel budget
    // protects mobile devices from allocating an excessively large canvas.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelBudget = 24_000_000;
    const requestedPixels = viewport.width * viewport.height * dpr * dpr;
    const outputScale = requestedPixels > pixelBudget
      ? Math.sqrt(pixelBudget / (viewport.width * viewport.height))
      : dpr;

    const pixelWidth = Math.max(1, Math.floor(viewport.width * outputScale));
    const pixelHeight = Math.max(1, Math.floor(viewport.height * outputScale));

    // Assign fresh backing dimensions on every render. This discards the old
    // bitmap so zoom can never merely stretch a low-resolution previous page.
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const transform = outputScale !== 1
      ? [outputScale, 0, 0, outputScale, 0, 0]
      : null;

    const task = page.render({
      canvasContext: context,
      viewport,
      transform,
      background: "#ffffff"
    });
    activeRenderTask = task;
    await task.promise;

    if (generation !== renderGeneration) return;
    activeRenderTask = null;
    showMessage("");
    updateControls();
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    console.error("PDF page rendering failed:", error);
    if (generation === renderGeneration) {
      showMessage("This page could not be rendered. Try reloading the document.", true);
    }
  }
}

async function goToPage(pageNumber) {
  if (!pdfDocument) return;
  const target = Math.max(1, Math.min(pdfDocument.numPages, Math.trunc(Number(pageNumber)) || 1));
  if (target === currentPage) {
    updateControls();
    return;
  }
  currentPage = target;
  updateControls();
  await renderCurrentPage();
}

async function loadDocument() {
  try {
    const path = requestedFile.replace(/^\/+/, "");
    if (
      /^[a-z][a-z\d+.-]*:/i.test(path) ||
      path.split("/").includes("..") ||
      !path.toLowerCase().endsWith(".pdf")
    ) {
      throw new Error("Use a relative path to a PDF inside this repository.");
    }

    const url = new URL(path, document.baseURI).href;
    const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });
    pdfDocument = await loadingTask.promise;

    totalPagesLabel.textContent = String(pdfDocument.numPages);
    pageInput.max = String(pdfDocument.numPages);
    await renderCurrentPage();
  } catch (error) {
    console.error("PDF loading failed:", error);
    showMessage(`Unable to open PDF: ${error.message || "Check the file path and try again."}`, true);
  }
}

prevButton.addEventListener("click", () => goToPage(currentPage - 1));
nextButton.addEventListener("click", () => goToPage(currentPage + 1));

pageIndexButton.addEventListener("click", () => {
  pageJump.hidden = !pageJump.hidden;
  if (!pageJump.hidden) {
    pageInput.value = String(currentPage);
    pageInput.focus();
    pageInput.select();
  }
});

pageJump.addEventListener("submit", event => {
  event.preventDefault();
  goToPage(pageInput.value);
  pageJump.hidden = true;
});

document.addEventListener("pointerdown", event => {
  if (!pageJump.hidden &&
      !pageJump.contains(event.target) &&
      !pageIndexButton.contains(event.target)) {
    pageJump.hidden = true;
  }
});

document.getElementById("zoom-in").addEventListener("click", () => {
  zoom = Math.min(4, Math.round((zoom + 0.2) * 100) / 100);
  renderCurrentPage();
});
document.getElementById("zoom-out").addEventListener("click", () => {
  zoom = Math.max(0.5, Math.round((zoom - 0.2) * 100) / 100);
  renderCurrentPage();
});

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderCurrentPage(), 160);
});

document.addEventListener("keydown", event => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    goToPage(currentPage + 1);
  } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    goToPage(currentPage - 1);
  } else if (event.key === "+" || event.key === "=") {
    zoom = Math.min(4, Math.round((zoom + 0.2) * 100) / 100);
    renderCurrentPage();
  } else if (event.key === "-") {
    zoom = Math.max(0.5, Math.round((zoom - 0.2) * 100) / 100);
    renderCurrentPage();
  } else if (event.key === "Escape") {
    pageJump.hidden = true;
  }
});

updateControls();
loadDocument();
