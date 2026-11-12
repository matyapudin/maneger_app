import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { recordSync } from "@/lib/db";
import { buildAuthUrl, getGoogleConfig, STATE_COOKIE } from "@/lib/google";

// Starts the Google sign-in: redirects the browser to Google's consent screen.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const config = getGoogleConfig();
  if (!config) {
    recordSync("gmail", false, "Google の設定（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）がありません。");
    return NextResponse.redirect(new URL("/mail", origin));
  }

  // Random state protects the callback against forged requests (CSRF).
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(config, origin, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
