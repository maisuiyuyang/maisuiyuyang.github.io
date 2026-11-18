import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const params = new URLSearchParams(window.location.search);
const requestedFile = params.get("file") || "pdfs/article.pdf";

const viewer = document.getElementById("viewer");
const pagesRoot = document.getElementById("pages");
const message = document.getElementById("message");
const pageInput = document.getElementById("page-number");
const pageCount = document.getElementById("page-count");
const zoomLabel = document.getElementById("zoom-level");
const prevButton = document.getElementById("prev");
const nextButton = document.getElementById("next");

let pdf = null;
let scale = 1;
let fitWidth = true;
let currentPage = 1;
let pageElements = [];
let renderTasks = new Map();
let rendering = new Set();
let intersectionObserver;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
  message.hidden = !text;
}

function updateControls() {
  pageInput.value = String(currentPage);
  pageInput.max = String(pdf?.numPages || 1);
  pageCount.textContent = pdf ? String(pdf.numPages) : "—";
  prevButton.disabled = !pdf || currentPage <= 1;
  nextButton.disabled = !pdf || currentPage >= pdf.numPages;
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
}

function getScale(page) {
  const base = page.getViewport({ scale: 1 });
  if (fitWidth) {
    const available = Math.max(240, viewer.clientWidth - 24);
    return Math.min(2.5, available / base.width);
  }
  return scale;
}

async function renderPage(pageNumber) {
  if (!pdf || rendering.has(pageNumber)) return;
  const canvas = pageElements[pageNumber - 1];
  if (!canvas || canvas.dataset.rendered === "true") return;

  rendering.add(pageNumber);
  try {
    const page = await pdf.getPage(pageNumber);
    const pageScale = getScale(page);
    const viewport = page.getViewport({ scale: pageScale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const task = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
    });
    renderTasks.set(pageNumber, task);
    await task.promise;
    canvas.dataset.rendered = "true";
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(`Failed to render page ${pageNumber}`, error);
    }
  } finally {
    rendering.delete(pageNumber);
    renderTasks.delete(pageNumber);
  }
}

function observePages() {
  intersectionObserver?.disconnect();
  intersectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const pageNumber = Number(entry.target.dataset.page);
        renderPage(pageNumber);
      }
    }
  }, { root: viewer, rootMargin: "900px 0px" });

  pageElements.forEach(canvas => intersectionObserver.observe(canvas));
}

async function buildPages() {
  pagesRoot.replaceChildren();
  pageElements = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.dataset.page = String(i);
    canvas.setAttribute("aria-label", `Page ${i}`);
    pagesRoot.appendChild(canvas);
    pageElements.push(canvas);
  }
  observePages();
  await renderPage(1);
  setMessage("");
}

async function loadPdf() {
  try {
    // Keep the requested document inside this GitHub Pages site.
    const filePath = requestedFile.replace(/^\/+/, "");
    if (/^[a-z][a-z\d+.-]*:/i.test(filePath) || filePath.split("/").includes("..")) {
      throw new Error("Invalid PDF path. Use a relative path inside this repository.");
    }

    const loadingTask = pdfjsLib.getDocument({
      url: new URL(filePath, document.baseURI).href,
      withCredentials: false
    });
    pdf = await loadingTask.promise;
    await buildPages();
    updateControls();
    updateCurrentPageFromScroll();
  } catch (error) {
    console.error(error);
    setMessage(`Unable to open PDF: ${error.message || "Please check the file path."}`, true);
  }
}

function updateCurrentPageFromScroll() {
  if (!pageElements.length) return;
  const viewerRect = viewer.getBoundingClientRect();
  let bestPage = currentPage;
  let bestDistance = Infinity;

  pageElements.forEach((canvas, index) => {
    const rect = canvas.getBoundingClientRect();
    const distance = Math.abs((rect.top + rect.bottom) / 2 - (viewerRect.top + viewerRect.bottom) / 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = index + 1;
    }
  });

  currentPage = bestPage;
  updateControls();
}

function goToPage(pageNumber) {
  if (!pdf) return;
  const target = Math.max(1, Math.min(pdf.numPages, Math.floor(pageNumber) || 1));
  currentPage = target;
  pageElements[target - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  renderPage(target);
  updateControls();
}

async function rerenderAll() {
  if (!pdf) return;
  for (const task of renderTasks.values()) {
    try { task.cancel(); } catch {}
  }
  pageElements.forEach(canvas => {
    canvas.dataset.rendered = "false";
    canvas.width = 0;
    canvas.height = 0;
  });
  await renderPage(currentPage);
  updateControls();
}

prevButton.addEventListener("click", () => goToPage(currentPage - 1));
nextButton.addEventListener("click", () => goToPage(currentPage + 1));
pageInput.addEventListener("change", () => goToPage(Number(pageInput.value)));

document.getElementById("zoom-in").addEventListener("click", () => {
  fitWidth = false;
  scale = Math.min(3, scale + 0.15);
  rerenderAll();
});
document.getElementById("zoom-out").addEventListener("click", () => {
  fitWidth = false;
  scale = Math.max(0.4, scale - 0.15);
  rerenderAll();
});
document.getElementById("fit-width").addEventListener("click", () => {
  fitWidth = true;
  rerenderAll();
});

let scrollTimer;
viewer.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(updateCurrentPageFromScroll, 100);
});

let resizeTimer;
window.addEventListener("resize", () => {
  if (!fitWidth) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rerenderAll, 180);
});

loadPdf();
