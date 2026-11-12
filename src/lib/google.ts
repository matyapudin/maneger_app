// Google integration via OAuth 2.0: Gmail (read-only) and Google Calendar.
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server
//       https://developers.google.com/gmail/api/reference/rest
//       https://developers.google.com/calendar/api/v3/reference

import { clearOAuthToken, getOAuthToken, getSetting, saveOAuthToken } from "@/lib/db";

// Cookie holding the OAuth "state" value between the redirect and the callback.
export const STATE_COOKIE = "google_oauth_state";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Least privilege for the calendar: read the calendar list and events, and
// write only to calendars this app creates (the deadlines calendar).
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
];

const ALL_SCOPES = [GMAIL_SCOPE, ...CALENDAR_SCOPES];

// Test-only: point every Google endpoint at a local mock server.
const MOCK = process.env.GOOGLE_MOCK_BASE_URL?.replace(/\/+$/, "");
const AUTH_URL = MOCK ? `${MOCK}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = MOCK ? `${MOCK}/token` : "https://oauth2.googleapis.com/token";
const REVOKE_URL = MOCK ? `${MOCK}/revoke` : "https://oauth2.googleapis.com/revoke";
const GMAIL_API = MOCK ? `${MOCK}/gmail/v1` : "https://gmail.googleapis.com/gmail/v1";
export const CALENDAR_API = MOCK
  ? `${MOCK}/calendar/v3`
  : "https://www.googleapis.com/calendar/v3";

// code: "api_disabled" (the API is off in Google Cloud),
//       "insufficient_scope" (permission not granted yet).
export class GoogleError extends Error {
  constructor(
    message: string,
    public readonly needsReconnect = false,
    public readonly code?: "api_disabled" | "insufficient_scope",
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export type GoogleConfig = { clientId: string; clientSecret: string };

export const GOOGLE_CLIENT_ID_KEY = "google_client_id";
// "1" = import only Gmail's Primary tab (skip Promotions, Social, Updates, Forums).
export const GMAIL_PRIMARY_ONLY_KEY = "gmail_primary_only";
export const GOOGLE_CLIENT_SECRET_KEY = "google_client_secret";

// The Google OAuth client entered on the 設定 screen.
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.local still work as a fallback.
export function getGoogleConfig(): GoogleConfig | null {
  const clientId = (getSetting(GOOGLE_CLIENT_ID_KEY) ?? process.env.GOOGLE_CLIENT_ID)?.trim();
  const clientSecret = (
    getSetting(GOOGLE_CLIENT_SECRET_KEY) ?? process.env.GOOGLE_CLIENT_SECRET
  )?.trim();
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
    scope: ALL_SCOPES.join(" "),
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
  scope?: string; // space-separated scopes actually granted
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

type ApiError = {
  error?: { message?: string; errors?: { reason?: string }[]; status?: string };
};

// Calls a Google API with the access token and turns errors into GoogleError.
export async function googleFetch<T>(
  url: string,
  accessToken: string,
  service: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GoogleError(`${service} に接続できませんでした（${(e as Error).message}）`);
  }
  if (res.status === 401) throw new GoogleError(`${service} の認証が切れました`, true);
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    const reasons = err?.error?.errors?.map((e) => e.reason) ?? [];
    const message = err?.error?.message ?? `${service} のエラー（HTTP ${res.status}）`;
    if (reasons.includes("accessNotConfigured") || /has not been used|is disabled/i.test(message)) {
      throw new GoogleError(`${service} の API が Google Cloud で有効になっていません`, false, "api_disabled");
    }
    if (reasons.includes("insufficientPermissions") || err?.error?.status === "PERMISSION_DENIED") {
      throw new GoogleError(`${service} を使う許可がまだありません`, false, "insufficient_scope");
    }
    throw new GoogleError(message);
  }
  return (await res.json()) as T;
}

async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
  return googleFetch<T>(`${GMAIL_API}${path}`, accessToken, "Gmail");
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
    scopes: t.scope ?? GMAIL_SCOPE,
  });
}

// Whether the user has granted the calendar permissions (older connections
// only have Gmail; they need to connect once more).
export function hasCalendarAccess(): boolean {
  const scopes = getOAuthToken("google")?.scopes?.split(" ") ?? [];
  return CALENDAR_SCOPES.every((s) => scopes.includes(s));
}

export async function getAccessToken(config: GoogleConfig): Promise<string> {
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
    scopes: t.scope ?? stored.scopes,
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
    `/users/me/messages?${new URLSearchParams({
      maxResults: String(max),
      q: getSetting(GMAIL_PRIMARY_ONLY_KEY) === "1" ? "in:inbox category:primary" : "in:inbox",
    })}`,
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
