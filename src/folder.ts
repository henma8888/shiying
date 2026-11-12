import { copy } from "./copy";

export const SHIYING_FOLDER = "拾影";

export const DOWNLOADS_PICKER = {
  id: "shiying",
  startIn: "downloads",
  mode: "readwrite",
} as const;

export type SaveKind = "folder" | "fallback";

export interface SaveDirectory {
  write(filename: string, data: Blob): Promise<void>;
}

export type SaveTarget = { kind: "folder"; directory: SaveDirectory } | { kind: "fallback" };

type Permission = "granted" | "prompt" | "denied";

export interface FolderStore {
  supported: boolean;
  load(): Promise<SaveDirectory | null>;
  save(directory: SaveDirectory): Promise<void>;
  query(directory: SaveDirectory): Promise<Permission>;
  request(directory: SaveDirectory): Promise<Permission>;
  pickDownloads(): Promise<SaveDirectory>;
  ensureSubfolder(parent: SaveDirectory, name: string): Promise<SaveDirectory>;
}

export function downloadedMessage(kind: SaveKind): string {
  return kind === "folder" ? copy.downloaded : copy.downloadedFallback;
}

export function shiyingDirectoryOptions(name = SHIYING_FOLDER): { name: string; create: true } {
  return { name, create: true };
}

export function safeDownloadName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned || "download";
}

async function permit(store: FolderStore, directory: SaveDirectory): Promise<boolean> {
  let permission = await store.query(directory);
  if (permission === "prompt") permission = await store.request(directory);
  return permission === "granted";
}

export async function resolveSaveTarget(store: FolderStore): Promise<SaveTarget> {
  if (!store.supported) return { kind: "fallback" };

  try {
    const stored = await store.load();
    if (stored && (await permit(store, stored))) {
      return { kind: "folder", directory: stored };
    }
  } catch {
    /* The remembered folder is gone. Ask again. */
  }

  try {
    const parent = await store.pickDownloads();
    const folder = await store.ensureSubfolder(parent, SHIYING_FOLDER);
    try {
      await store.save(folder);
    } catch {
      /* This visit can still write. The next visit will ask again. */
    }
    return { kind: "folder", directory: folder };
  } catch {
    return { kind: "fallback" };
  }
}

export async function deliverFile(
  target: SaveTarget,
  blob: Blob,
  filename: string,
  fallback: (blob: Blob, filename: string) => void,
): Promise<SaveKind> {
  const name = safeDownloadName(filename);
  if (target.kind === "folder") {
    try {
      await target.directory.write(name, blob);
      return "folder";
    } catch {
      fallback(blob, name);
      return "fallback";
    }
  }
  fallback(blob, name);
  return "fallback";
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: "readwrite" }): Promise<Permission>;
  requestPermission(descriptor: { mode: "readwrite" }): Promise<Permission>;
};

const DB_NAME = "shiying";
const STORE_NAME = "kv";
const HANDLE_KEY = "downloads-folder";
const WRITE = { mode: "readwrite" } as const;

class HandleDirectory implements SaveDirectory {
  constructor(readonly handle: PermissionHandle) {}

  async write(filename: string, data: Blob): Promise<void> {
    const file = await this.handle.getFileHandle(safeDownloadName(filename), { create: true });
    const stream = await file.createWritable();
    try {
      await stream.write(data);
    } finally {
      await stream.close();
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}

export function browserFolderStore(): FolderStore {
  const supported = typeof window.showDirectoryPicker === "function";
  return {
    supported,
    async load() {
      const handle = await withStore<PermissionHandle | undefined>("readonly", (store) => store.get(HANDLE_KEY));
      return handle ? new HandleDirectory(handle) : null;
    },
    async save(directory) {
      if (!(directory instanceof HandleDirectory)) return;
      await withStore("readwrite", (store) => store.put(directory.handle, HANDLE_KEY));
    },
    query(directory) {
      return directory instanceof HandleDirectory ? directory.handle.queryPermission(WRITE) : Promise.resolve("denied");
    },
    request(directory) {
      return directory instanceof HandleDirectory
        ? directory.handle.requestPermission(WRITE)
        : Promise.resolve("denied");
    },
    async pickDownloads() {
      const pick = window.showDirectoryPicker;
      if (!pick) throw new Error("unsupported");
      const parent = await pick(DOWNLOADS_PICKER);
      return new HandleDirectory(parent as PermissionHandle);
    },
    async ensureSubfolder(parent, name) {
      if (!(parent instanceof HandleDirectory)) throw new Error("unsupported");
      const request = shiyingDirectoryOptions(name);
      const child = await parent.handle.getDirectoryHandle(request.name, { create: request.create });
      return new HandleDirectory(child as PermissionHandle);
    },
  };
}

let pending: Promise<SaveTarget> | null = null;

export function requestBrowserSaveTarget(): Promise<SaveTarget> {
  if (!pending) {
    pending = resolveSaveTarget(browserFolderStore()).finally(() => {
      pending = null;
    });
  }
  return pending;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: "downloads" | FileSystemHandle;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
