// Reading YouTube links typed by the user (for the BGM player).

// Accepts watch?v=, youtu.be/, /live/, /embed/, /shorts/ and playlist URLs,
// or a bare video ID. Returns a video ID or "list:<playlistId>".
export function parseYouTube(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$|^youtu\.be$/.test(u.hostname)) return null;
  const v = u.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const path = u.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{11})/) ?? (u.hostname === "youtu.be" ? u.pathname.match(/^\/([\w-]{11})/) : null);
  if (path) return path[1];
  const list = u.searchParams.get("list");
  if (list && /^[\w-]+$/.test(list)) return `list:${list}`;
  return null;
}
