import { unzipSync } from "fflate";
import { copy, errorMessage, type ErrorKind } from "./copy";
import { baseNameFor, MediaError, packageMedia } from "./download";
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

async function run(raw: string): Promise<void> {
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
    saveBlob(packed.blob, packed.filename);
    setStatus(copy.downloaded);
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
  void run(input.value);
});

input.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text.trim()) return;
  window.setTimeout(() => {
    void run(input.value);
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
    await run(text);
  } catch {
    setStatus(copy.clipboardDenied);
    input.focus();
  }
});

clearButton.addEventListener("click", () => {
  reset();
});
