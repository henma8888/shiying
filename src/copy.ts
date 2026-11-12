export type ErrorKind =
  | "invalid"
  | "unsupported"
  | "private"
  | "age"
  | "deleted"
  | "rate"
  | "network"
  | "empty"
  | "unavailable"
  | "remux";

export const errorMessage: Record<ErrorKind, string> = {
  invalid: "呢條唔係 Instagram 或 Threads 貼文連結。",
  unsupported: "限時動態同精選動態下載唔到。",
  private: "呢個帳號係私人，未登入攞唔到。",
  age: "呢則內容未滿 21 歲睇唔到，未登入攞唔到。",
  deleted: "搵唔到呢則貼文，可能已刪除。",
  rate: "Instagram 或 Threads 要求登入，或者暫時限流。等一陣再試。",
  network: "連線失敗，請再試一次。",
  empty: "呢則貼文冇相片或影片。",
  unavailable: "未登入搵唔到呢則貼文。可能已刪除、私人，或者要登入先睇到。",
  remux: "呢條片要合併音軌，瀏覽器而家做唔到。",
};

export const copy = {
  checking: "檢查緊…",
  downloaded: "已下載",
  downloadedFallback: "已下載。呢個瀏覽器會存入預設嘅下載項目或檔案。",
  clipboardEmpty: "剪貼簿入面冇 Instagram 或 Threads 連結。",
  clipboardDenied: "讀唔到剪貼簿。長按輸入框再貼上。",
};
