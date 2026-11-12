import { describe, expect, it, vi } from "vitest";
import {
  DOWNLOADS_PICKER,
  SHIYING_FOLDER,
  deliverFile,
  downloadedMessage,
  resolveSaveTarget,
  safeDownloadName,
  shiyingDirectoryOptions,
  type FolderStore,
  type SaveDirectory,
} from "./folder";

function memoryDir(name = "dir"): SaveDirectory & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>();
  return {
    files,
    async write(filename, data) {
      files.set(`${name}/${filename}`, data);
    },
  };
}

function store(partial: Partial<FolderStore> = {}): FolderStore & {
  picks: number;
  saved: SaveDirectory[];
  subfolders: string[];
} {
  const saved: SaveDirectory[] = [];
  const subfolders: string[] = [];
  const created = memoryDir(SHIYING_FOLDER);
  let picks = 0;
  const base: FolderStore = {
    supported: true,
    async load() {
      return null;
    },
    async save(directory) {
      saved.push(directory);
    },
    async query() {
      return "denied";
    },
    async request() {
      return "denied";
    },
    async pickDownloads() {
      picks += 1;
      return memoryDir("downloads");
    },
    async ensureSubfolder(_parent, name) {
      subfolders.push(name);
      return created;
    },
  };
  const merged = { ...base, ...partial, saved, subfolders, get picks() { return picks; } };
  return merged;
}

describe("resolveSaveTarget", () => {
  it("uses a normal download when the browser cannot pick a folder", async () => {
    const access = store({ supported: false, pickDownloads: vi.fn() });
    await expect(resolveSaveTarget(access)).resolves.toEqual({ kind: "fallback" });
    expect(access.pickDownloads).not.toHaveBeenCalled();
    expect(downloadedMessage("fallback")).toContain("預設");
    expect(downloadedMessage("folder")).toBe("已下載");
  });

  it("reuses a remembered 拾影 folder without asking again", async () => {
    const directory = memoryDir(SHIYING_FOLDER);
    const access = store({
      load: async () => directory,
      query: async () => "granted",
      pickDownloads: vi.fn(),
    });
    const target = await resolveSaveTarget(access);
    expect(target).toEqual({ kind: "folder", directory });
    expect(access.pickDownloads).not.toHaveBeenCalled();
  });

  it("renews a prompt permission without opening the folder picker", async () => {
    const directory = memoryDir(SHIYING_FOLDER);
    const access = store({
      load: async () => directory,
      query: async () => "prompt",
      request: async () => "granted",
      pickDownloads: vi.fn(),
    });
    const target = await resolveSaveTarget(access);
    expect(target.kind).toBe("folder");
    expect(access.pickDownloads).not.toHaveBeenCalled();
  });

  it("asks for Downloads once, then creates 拾影 inside it", async () => {
    const access = store();
    const target = await resolveSaveTarget(access);
    expect(access.picks).toBe(1);
    expect(access.subfolders).toEqual([SHIYING_FOLDER]);
    expect(access.saved).toHaveLength(1);
    expect(target.kind).toBe("folder");
    expect(DOWNLOADS_PICKER).toMatchObject({ startIn: "downloads", mode: "readwrite" });
    expect(shiyingDirectoryOptions()).toEqual({ name: "拾影", create: true });
  });

  it("falls back when the folder prompt is dismissed", async () => {
    const access = store({
      pickDownloads: async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      },
    });
    await expect(resolveSaveTarget(access)).resolves.toEqual({ kind: "fallback" });
  });
});

describe("deliverFile", () => {
  it("writes into the folder and keeps a single file out of a zip decision", async () => {
    const directory = memoryDir(SHIYING_FOLDER);
    const blob = new Blob(["photo"]);
    const fallback = vi.fn();
    const kind = await deliverFile({ kind: "folder", directory }, blob, "shiying_threads_CODE.jpg", fallback);
    expect(kind).toBe("folder");
    expect(fallback).not.toHaveBeenCalled();
    expect(directory.files.get(`${SHIYING_FOLDER}/shiying_threads_CODE.jpg`)).toBe(blob);
  });

  it("uses the normal download when the folder write fails", async () => {
    const directory: SaveDirectory = {
      async write() {
        throw new Error("disk");
      },
    };
    const blob = new Blob(["video"]);
    const fallback = vi.fn();
    const kind = await deliverFile({ kind: "folder", directory }, blob, "clip.mp4", fallback);
    expect(kind).toBe("fallback");
    expect(fallback).toHaveBeenCalledWith(blob, "clip.mp4");
    expect(downloadedMessage(kind)).toContain("已下載");
  });

  it("strips path pieces from the saved name", () => {
    expect(safeDownloadName("../下載/shiying_instagram_CODE.mp4")).toBe("shiying_instagram_CODE.mp4");
  });
});
