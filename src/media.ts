export type MediaKind = "photo" | "video";

export type MediaItem = {
  kind: MediaKind;
  url: string;
  thumb?: string;
};

export type Delivery = "none" | "single" | "each";

export function deliveryMode(count: number): Delivery {
  if (count <= 0) return "none";
  if (count === 1) return "single";
  return "each";
}

export function mediaFilename(baseName: string, index: number, total: number, ext: string): string {
  if (total <= 1) return `${baseName}.${ext}`;
  return `${baseName}_${String(index + 1).padStart(2, "0")}.${ext}`;
}

export function describeMedia(items: Pick<MediaItem, "kind">[]): string {
  const photos = items.filter((item) => item.kind === "photo").length;
  const videos = items.filter((item) => item.kind === "video").length;
  const parts: string[] = [];
  if (photos) parts.push(`${photos} 張相片`);
  if (videos) parts.push(`${videos} 條影片`);
  return parts.join("、");
}
