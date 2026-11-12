// Gmail integration via Google OAuth 2.0 (read-only access).
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server
//       https://developers.google.com/gmail/api/reference/rest

import { clearOAuthToken, getOAuthToken, saveOAuthToken } from "@/lib/db";

// Cookie holding the OAuth "state" value between the redirect and the callback.
export const STATE_COOKIE = "google_oauth_state";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Test-only: point every Google endpoint at a local mock server.
const MOCK = process.env.GOOGLE_MOCK_BASE_URL?.replace(/\/+$/, "");
const AUTH_URL = MOCK ? `${MOCK}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = MOCK ? `${MOCK}/token` : "https://oauth2.googleapis.com/token";
const REVOKE_URL = MOCK ? `${MOCK}/revoke` : "https://oauth2.googleapis.com/revoke";
const GMAIL_API = MOCK ? `${MOCK}/gmail/v1` : "https://gmail.googleapis.com/gmail/v1";

export class GoogleError extends Error {
  constructor(
    message: string,
    public readonly needsReconnect = false,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

type GoogleConfig = { clientId: string; clientSecret: string };

// Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (set them in .env.local).
export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function redirectUri(origin: string) {
  return `${origin}/api/auth/google/callback`;
}

export function buildAuthUrl(config: GoogleConfig, origin: string, state: string) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline", // get a refresh token
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GoogleError(`Google に接続できませんでした（${(e as Error).message}）`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    // invalid_grant = refresh token revoked or expired.
    throw new GoogleError(
      data.error_description ?? data.error ?? `HTTP ${res.status}`,
      data.error === "invalid_grant",
    );
  }
  return data;
}

async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GoogleError(`Gmail に接続できませんでした（${(e as Error).message}）`);
  }
  if (res.status === 401) throw new GoogleError("Gmail の認証が切れました", true);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new GoogleError(err?.error?.message ?? `Gmail のエラー（HTTP ${res.status}）`);
  }
  return (await res.json()) as T;
}

// Exchanges the authorization code from the callback and stores the tokens.
export async function completeAuth(config: GoogleConfig, origin: string, code: string) {
  const t = await tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  if (!t.refresh_token) {
    throw new GoogleError("Google から更新用トークンが返されませんでした。もう一度接続してください。");
  }
  const profile = await gmailGet<{ emailAddress: string }>("/users/me/profile", t.access_token);
  saveOAuthToken("google", {
    refreshToken: t.refresh_token,
    accessToken: t.access_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    account: profile.emailAddress,
  });
}

async function getAccessToken(config: GoogleConfig): Promise<string> {
  const stored = getOAuthToken("google");
  if (!stored) throw new GoogleError("Gmail が接続されていません", true);
  // Reuse the access token until one minute before it expires.
  if (stored.access_token && stored.expires_at && stored.expires_at - 60_000 > Date.now()) {
    return stored.access_token;
  }
  const t = await tokenRequest({
    refresh_token: stored.refresh_token,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  saveOAuthToken("google", {
    refreshToken: t.refresh_token ?? stored.refresh_token,
    accessToken: t.access_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    account: stored.account,
  });
  return t.access_token;
}

type MessageList = { messages?: { id: string; threadId: string }[] };
type Message = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate: string; // ms since epoch
  payload?: { headers?: { name: string; value: string }[] };
};

export type GmailMessage = {
  gmailId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string; // ISO 8601
  isRead: boolean;
  url: string;
};

// Fetches the newest inbox messages (metadata only, no bodies).
export async function fetchInbox(config: GoogleConfig, max = 30): Promise<GmailMessage[]> {
  const token = await getAccessToken(config);
  const account = getOAuthToken("google")?.account ?? "";
  const list = await gmailGet<MessageList>(
    `/users/me/messages?${new URLSearchParams({ maxResults: String(max), q: "in:inbox" })}`,
    token,
  );
  const ids = list.messages ?? [];
  const query = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "Subject"]) query.append("metadataHeaders", h);

  const results: GmailMessage[] = [];
  // Small batches keep us well under Gmail's per-user rate limits.
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(
      ids.slice(i, i + 10).map((m) => gmailGet<Message>(`/users/me/messages/${m.id}?${query}`, token)),
    );
    for (const m of batch) {
      const header = (name: string) =>
        m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      results.push({
        gmailId: m.id,
        sender: header("From") || "（差出人不明）",
        subject: header("Subject") || "（件名なし）",
        snippet: m.snippet ?? "",
        receivedAt: new Date(Number(m.internalDate)).toISOString(),
        isRead: !(m.labelIds ?? []).includes("UNREAD"),
        url: `https://mail.google.com/mail/?${new URLSearchParams({ authuser: account })}#all/${m.threadId}`,
      });
    }
  }
  return results;
}

// Revokes Google's access and forgets the stored tokens.
export async function disconnect() {
  const stored = getOAuthToken("google");
  clearOAuthToken("google");
  if (stored) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: stored.refresh_token }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      // Local tokens are already gone; revoking is best effort.
    });
  }
}
