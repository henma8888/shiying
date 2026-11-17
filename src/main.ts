import { copy, errorMessage, type ErrorKind } from "./copy";
import { attachmentBlob, baseNameFor, MediaError, packageMedia, saveVideoAsFile, type SavedFile } from "./download";
import { deliverFiles, downloadedMessage, requestBrowserSaveTarget, type SaveTarget } from "./folder";
import { shouldShowInstall } from "./install";
import { describeMedia, type MediaItem } from "./media";
import { parseInput } from "./url";
import { resolvePost } from "./resolve";
import "./style.css";

function required<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`拾影頁面未完整載入：${name}`);
  return value;
}

const form = required(document.querySelector<HTMLFormElement>("#form"), "form");
const input = required(document.querySelector<HTMLInputElement>("#url"), "url");
const pasteButton = required(document.querySelector<HTMLButtonElement>("#paste"), "paste");
const pasteDownloadButton = required(document.querySelector<HTMLButtonElement>("#paste-download"), "paste-download");
const clearButton = required(document.querySelector<HTMLButtonElement>("#clear"), "clear");
const downloadButton = required(document.querySelector<HTMLButtonElement>("#download"), "download");
const status = required(document.querySelector<HTMLParagraphElement>("#status"), "status");
const preview = required(document.querySelector<HTMLDivElement>("#preview"), "preview");
const installButton = required(document.querySelector<HTMLButtonElement>("#install"), "install");

let job = 0;
let controller: AbortController | null = null;
let ready: SavedFile[] | null = null;
const previewUrls: string[] = [];
const saveVideoFile = saveVideoAsFile(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

function setStatus(text: string): void {
  status.textContent = text;
}

function clearPreview(): void {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls.length = 0;
  preview.replaceChildren();
}

function showPreview(items: MediaItem[], blobs: Blob[]): void {
  clearPreview();
  items.slice(0, 8).forEach((item, index) => {
    const blob = blobs[index];
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    previewUrls.push(objectUrl);
    if (item.kind === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("aria-label", "影片預覽");
      if (item.thumb) video.poster = item.thumb;
      preview.append(video);
      video.src = objectUrl;
      video.load();
      return;
    }
    const image = document.createElement("img");
    image.src = objectUrl;
    image.alt = `相片 ${index + 1}`;
    preview.append(image);
  });
}

function setReady(files: SavedFile[] | null): void {
  ready = files;
  downloadButton.hidden = !files?.length;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(attachmentBlob(blob, saveVideoFile));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function saveNow(files: SavedFile[]): void {
  for (const file of files) saveBlob(file.blob, file.filename);
}

function setBusy(busy: boolean): void {
  pasteButton.disabled = busy;
  pasteDownloadButton.disabled = busy;
}

function reset(): void {
  job += 1;
  controller?.abort();
  controller = null;
  input.value = "";
  setStatus("");
  clearPreview();
  setReady(null);
  setBusy(false);
  input.focus();
}

async function readClipboard(): Promise<string | null> {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!parseInput(text).ok) {
      setStatus(copy.clipboardEmpty);
      return null;
    }
    return text;
  } catch {
    setStatus(copy.clipboardDenied);
    input.focus();
    return null;
  }
}

async function run(raw: string, mode: "preview" | "download", folder?: Promise<SaveTarget>): Promise<void> {
  const text = raw.trim();
  if (!text) return;
  const parsed = parseInput(text);
  if (!parsed.ok) {
    setStatus(errorMessage.invalid);
    clearPreview();
    setReady(null);
    return;
  }

  const id = ++job;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  setStatus(copy.checking);
  clearPreview();
  setReady(null);
  setBusy(true);

  try {
    const resolved = await resolvePost(parsed.canonical, { signal: current.signal });
    if (id !== job) return;
    if (!resolved.ok) {
      setStatus(resolved.message);
      return;
    }

    const summary = describeMedia(resolved.items);
    const files = await packageMedia(
      resolved.items,
      baseNameFor(resolved.service, resolved.code),
      current.signal,
    );
    if (id !== job) return;
    showPreview(resolved.items, files.map((file) => file.blob));
    setReady(files);
    if (mode === "preview") {
      setStatus(summary);
      return;
    }

    setStatus(`${summary}，下載緊…`);
    const target = await (folder ?? requestBrowserSaveTarget());
    if (id !== job) return;
    const where = await deliverFiles(target, files, saveBlob);
    if (id !== job) return;
    setStatus(downloadedMessage(where));
  } catch (error) {
    if (id !== job || (error instanceof Error && error.name === "AbortError")) return;
    const kind: ErrorKind = error instanceof MediaError ? error.kind : "network";
    setStatus(errorMessage[kind]);
  } finally {
    if (id === job) setBusy(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void run(input.value, "preview");
});

input.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!parseInput(text).ok) return;
  event.preventDefault();
  input.value = "";
  void run(text, "preview");
});

pasteButton.addEventListener("click", () => {
  const reading = readClipboard();
  void (async () => {
    const text = await reading;
    if (!text) return;
    input.value = "";
    await run(text, "preview");
  })();
});

pasteDownloadButton.addEventListener("click", () => {
  const folder = requestBrowserSaveTarget();
  const reading = readClipboard();
  void (async () => {
    const text = await reading;
    if (!text) return;
    input.value = "";
    await run(text, "download", folder);
  })();
});

downloadButton.addEventListener("click", () => {
  const files = ready;
  if (!files?.length) return;
  if (typeof window.showDirectoryPicker !== "function") {
    saveNow(files);
    setStatus(copy.downloadedFallback);
    return;
  }
  const folder = requestBrowserSaveTarget();
  void (async () => {
    const where = await deliverFiles(await folder, files, saveBlob);
    setStatus(downloadedMessage(where));
  })();
});

clearButton.addEventListener("click", () => {
  reset();
});

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let installPrompt: InstallPrompt | null = null;

function syncInstallButton(): void {
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  installButton.hidden = !shouldShowInstall(installPrompt !== null, standalone);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
  syncInstallButton();
});

installButton.addEventListener("click", async () => {
  const pending = installPrompt;
  if (!pending) return;
  installPrompt = null;
  syncInstallButton();
  await pending.prompt();
  await pending.userChoice;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  syncInstallButton();
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
    updateViaCache: "none",
  });
}
