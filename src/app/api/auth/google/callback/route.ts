import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { recordSync } from "@/lib/db";
import { completeAuth, getGoogleConfig, STATE_COOKIE } from "@/lib/google";

function sameState(a: string | undefined, b: string | null) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Google redirects here after the user approves (or denies) access.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const res = NextResponse.redirect(new URL("/mail", origin));
  res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/google" });

  const config = getGoogleConfig();
  if (!config) {
    recordSync("gmail", false, "Google の設定（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）がありません。");
    return res;
  }
  if (params.get("error")) {
    recordSync(
      "gmail",
      false,
      params.get("error") === "access_denied"
        ? "Gmail へのアクセスが許可されませんでした。"
        : `Google でエラーが起きました（${params.get("error")}）。`,
    );
    return res;
  }
  if (!sameState(request.cookies.get(STATE_COOKIE)?.value, params.get("state"))) {
    recordSync("gmail", false, "接続を確認できませんでした。もう一度「Gmail に接続」を押してください。");
    return res;
  }
  const code = params.get("code");
  if (!code) {
    recordSync("gmail", false, "Google から認証コードが返されませんでした。");
    return res;
  }

  try {
    await completeAuth(config, origin, code);
    recordSync("gmail", true, "Gmail に接続しました。「Gmail から取り込む」を押してください。");
  } catch (e) {
    recordSync("gmail", false, `Gmail への接続に失敗しました：${(e as Error).message}`);
  }
  return res;
}
