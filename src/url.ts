export type Service = "instagram" | "threads";

export type ParsedLink =
  | {
      ok: true;
      service: Service;
      kind: "post" | "story";
      canonical: string;
      code: string | null;
    }
  | { ok: false };

const CODE = "([A-Za-z0-9_-]+)";

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function firstUrl(text: string): string | null {
  const trimmed = text.trim();
  const absolute = trimmed.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  const bare = trimmed.match(
    /(?:[a-z0-9-]+\.)?(?:instagram\.com|instagr\.am|threads\.(?:net|com))\/[^\s<>"']+/i,
  )?.[0];
  const raw = absolute ?? bare;
  if (!raw) return null;
  const cleaned = raw.replace(/[),.\]]+$/, "");
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
}

export function parseInput(text: string): ParsedLink {
  const raw = firstUrl(text);
  if (!raw) return { ok: false };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };

  const host = stripWww(url.hostname);
  const path = url.pathname;

  if (host === "instagram.com" || host === "instagr.am" || host === "m.instagram.com") {
    return parseInstagram(path);
  }
  if (host === "threads.com" || host === "threads.net") {
    return parseThreads(path);
  }
  return { ok: false };
}

function parseInstagram(path: string): ParsedLink {
  const highlights = path.match(/^\/stories\/highlights\/([^/]+)\/?$/i);
  if (highlights?.[1]) {
    return {
      ok: true,
      service: "instagram",
      kind: "story",
      canonical: `https://www.instagram.com/stories/highlights/${highlights[1]}/`,
      code: highlights[1],
    };
  }

  const story = path.match(/^\/stories\/([^/]+)\/(\d+)\/?$/i);
  if (story?.[1] && story[2]) {
    return {
      ok: true,
      service: "instagram",
      kind: "story",
      canonical: `https://www.instagram.com/stories/${story[1]}/${story[2]}/`,
      code: story[2],
    };
  }

  const share = path.match(new RegExp(`^\\/share\\/(?:(p|reels?|tv)\\/)?${CODE}\\/?$`, "i"));
  if (share?.[2]) {
    const bucket = (share[1] ?? "p").toLowerCase() === "reels" ? "reel" : (share[1] ?? "p").toLowerCase();
    return {
      ok: true,
      service: "instagram",
      kind: "post",
      canonical: `https://www.instagram.com/share/${bucket}/${share[2]}/`,
      code: null,
    };
  }

  const post = path.match(
    new RegExp(`^(?:\\/[^/]+)?\\/(p|reels?|tv)\\/${CODE}(?:\\/.*)?$`, "i"),
  );
  if (post?.[1] && post[2]) {
    const bucket = post[1].toLowerCase() === "reels" ? "reel" : post[1].toLowerCase();
    return {
      ok: true,
      service: "instagram",
      kind: "post",
      canonical: `https://www.instagram.com/${bucket}/${post[2]}/`,
      code: post[2],
    };
  }

  return { ok: false };
}

function parseThreads(path: string): ParsedLink {
  const share = path.match(new RegExp(`^\\/share\\/${CODE}\\/?$`));
  if (share?.[1]) {
    return {
      ok: true,
      service: "threads",
      kind: "post",
      canonical: `https://www.threads.com/share/${share[1]}/`,
      code: null,
    };
  }

  const userPost = path.match(new RegExp(`^\\/@([^/]+)\\/post\\/${CODE}(?:\\/.*)?$`));
  if (userPost?.[1] && userPost[2]) {
    return {
      ok: true,
      service: "threads",
      kind: "post",
      canonical: `https://www.threads.com/@${userPost[1]}/post/${userPost[2]}`,
      code: userPost[2],
    };
  }

  const short = path.match(new RegExp(`^\\/(?:t|post)\\/${CODE}(?:\\/.*)?$`, "i"));
  if (short?.[1]) {
    return {
      ok: true,
      service: "threads",
      kind: "post",
      canonical: `https://www.threads.com/t/${short[1]}`,
      code: short[1],
    };
  }

  return { ok: false };
}
