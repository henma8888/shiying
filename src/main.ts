import { unzipSync } from "fflate";
import { copy, errorMessage, type ErrorKind } from "./copy";
import { baseNameFor, MediaError, packageMedia } from "./download";
import { deliverFile, downloadedMessage, requestBrowserSaveTarget, type SaveTarget } from "./folder";
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
const clearButton = required(document.querySelector<HTMLButtonElement>("#clear"), "clear");
const status = required(document.querySelector<HTMLParagraphElement>("#status"), "status");
const preview = required(document.querySelector<HTMLDivElement>("#preview"), "preview");
const installButton = required(document.querySelector<HTMLButtonElement>("#install"), "install");

let job = 0;
let controller: AbortController | null = null;
const previewUrls: string[] = [];

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
      video.src = objectUrl;
      video.controls = true;
      video.playsInline = true;
      video.setAttribute("aria-label", "影片預覽");
      preview.append(video);
      return;
    }
    const image = document.createElement("img");
    image.src = objectUrl;
    image.alt = `相片 ${index + 1}`;
    preview.append(image);
  });
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function folderFor(raw: string): Promise<SaveTarget> | undefined {
  const parsed = parseInput(raw);
  if (!parsed.ok || parsed.kind === "story") return undefined;
  return requestBrowserSaveTarget();
}

function reset(): void {
  job += 1;
  controller?.abort();
  controller = null;
  input.value = "";
  setStatus("");
  clearPreview();
  pasteButton.disabled = false;
  input.focus();
}

async function run(raw: string, folder?: Promise<SaveTarget>): Promise<void> {
  const text = raw.trim();
  if (!text) return;
  const parsed = parseInput(text);
  if (!parsed.ok) {
    setStatus(errorMessage.invalid);
    clearPreview();
    return;
  }

  const id = ++job;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  input.value = parsed.canonical;
  input.scrollLeft = 0;
  setStatus(copy.checking);
  clearPreview();
  pasteButton.disabled = true;

  try {
    const resolved = await resolvePost(parsed.canonical, { signal: current.signal });
    if (id !== job) return;
    if (!resolved.ok) {
      setStatus(resolved.message);
      return;
    }

    const summary = describeMedia(resolved.items);
    setStatus(`${summary}，下載緊…`);
    const packed = await packageMedia(
      resolved.items,
      baseNameFor(resolved.service, resolved.code),
      current.signal,
    );
    if (id !== job) return;
    const blobs = resolved.items.length === 1 ? [packed.blob] : await blobsFromZip(packed.blob, resolved.items);
    showPreview(resolved.items, blobs);
    const target = await (folder ?? requestBrowserSaveTarget());
    if (id !== job) return;
    const where = await deliverFile(target, packed.blob, packed.filename, saveBlob);
    setStatus(downloadedMessage(where));
  } catch (error) {
    if (id !== job || (error instanceof Error && error.name === "AbortError")) return;
    const kind: ErrorKind = error instanceof MediaError ? error.kind : "network";
    setStatus(errorMessage[kind]);
  } finally {
    if (id === job) pasteButton.disabled = false;
  }
}

async function blobsFromZip(blob: Blob, items: MediaItem[]): Promise<Blob[]> {
  if (items.length === 1) return [blob];
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.keys(files)
    .sort()
    .map((name) => {
      const bytes = files[name];
      const copy = new Uint8Array(bytes?.byteLength ?? 0);
      if (bytes) copy.set(bytes);
      const type = name.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
      return new Blob([copy], { type });
    });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const folder = folderFor(input.value);
  void run(input.value, folder);
});

input.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text.trim()) return;
  const folder = folderFor(text);
  window.setTimeout(() => {
    void run(input.value, folder);
  }, 0);
});

pasteButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!parseInput(text).ok) {
      setStatus(copy.clipboardEmpty);
      return;
    }
    input.value = text.trim();
    await run(text, folderFor(text));
  } catch {
    setStatus(copy.clipboardDenied);
    input.focus();
  }
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
  });
}
