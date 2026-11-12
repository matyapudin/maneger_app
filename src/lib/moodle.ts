// Minimal client for the Moodle web service API (AIMS runs on Moodle).
// Docs: https://docs.moodle.org/dev/Web_service_API_functions

import { getServiceToken, saveServiceToken } from "@/lib/db";

export const AIMS_SERVICE = "aims";

export class MoodleError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "MoodleError";
  }
}

export type MoodleConfig = { baseUrl: string; token: string };

// AIMS address; MOODLE_BASE_URL can point elsewhere (e.g. a test server).
export function moodleBaseUrl() {
  return (process.env.MOODLE_BASE_URL?.trim() || "https://aims.aiu.ac.jp").replace(/\/+$/, "");
}

// The token saved by logging in from the app, or null if not logged in yet.
export function getMoodleConfig(): MoodleConfig | null {
  const saved = getServiceToken(AIMS_SERVICE);
  return saved ? { baseUrl: moodleBaseUrl(), token: saved.token } : null;
}

type TokenResponse = { token?: string; error?: string; errorcode?: string };
type SiteInfo = { fullname?: string; username?: string };

// Logs in like the official Moodle app: exchanges username/password for a
// web service token. Only the token is stored; the password is not kept.
export async function loginToMoodle(username: string, password: string): Promise<string> {
  const baseUrl = moodleBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/login/token.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, service: "moodle_mobile_app" }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new MoodleError(`AIMS に接続できませんでした（${(e as Error).message}）`);
  }
  if (!res.ok) throw new MoodleError(`AIMS がエラーを返しました（HTTP ${res.status}）`);
  const data = (await res.json()) as TokenResponse;
  if (!data.token) {
    throw new MoodleError(data.error ?? "AIMS からキーを受け取れませんでした", data.errorcode);
  }
  const info = await call<SiteInfo>({ baseUrl, token: data.token }, "core_webservice_get_site_info");
  const account = info.fullname || info.username || username;
  saveServiceToken(AIMS_SERVICE, data.token, account);
  return account;
}

async function call<T>(
  config: MoodleConfig,
  wsfunction: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const body = new URLSearchParams({
    wstoken: config.token,
    wsfunction,
    moodlewsrestformat: "json",
  });
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new MoodleError(`AIMS に接続できませんでした（${(e as Error).message}）`);
  }
  if (!res.ok) {
    throw new MoodleError(`AIMS がエラーを返しました（HTTP ${res.status}）`);
  }
  const data = (await res.json()) as T & {
    exception?: string;
    errorcode?: string;
    message?: string;
  };
  if (data && typeof data === "object" && "exception" in data && data.exception) {
    throw new MoodleError(data.message ?? "AIMS のエラー", data.errorcode);
  }
  return data;
}

type AssignmentsResponse = {
  courses: {
    id: number;
    fullname: string;
    shortname: string;
    assignments: {
      id: number;
      cmid: number;
      name: string;
      duedate: number; // unix seconds, 0 = no due date
      nosubmissions?: number; // 1 = students submit nothing in Moodle
      configs?: { plugin: string; subtype: string; name: string; value: string }[];
    }[];
  }[];
};

type SubmissionStatusResponse = {
  lastattempt?: {
    submission?: { status?: string };
    teamsubmission?: { status?: string };
  };
};

export type MoodleAssignment = {
  sourceId: string;
  courseId: number;
  course: string;
  title: string;
  dueAt: string | null; // ISO 8601 (UTC)
  submitted: boolean;
  requiresSubmission: boolean;
  url: string;
};

type AssignmentInfo = AssignmentsResponse["courses"][number]["assignments"][number];

// An assignment needs a submission only if Moodle has a way to submit it:
// not marked "no submissions", and at least one submission type (file,
// online text, ...) enabled. Feedback comments don't count.
export function requiresSubmission(a: AssignmentInfo): boolean {
  if (a.nosubmissions === 1) return false;
  if (!a.configs) return true; // older Moodle without configs: assume yes
  return a.configs.some(
    (c) =>
      c.subtype === "assignsubmission" &&
      c.name === "enabled" &&
      c.value === "1" &&
      c.plugin !== "comments",
  );
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Fetches every assignment in the user's enrolled courses, with submission status.
export async function fetchAssignments(config: MoodleConfig): Promise<MoodleAssignment[]> {
  const data = await call<AssignmentsResponse>(config, "mod_assign_get_assignments");
  const flat = data.courses.flatMap((c) =>
    c.assignments.map((a) => ({ courseId: c.id, course: c.fullname, a })),
  );

  return mapWithLimit(flat, 5, async ({ courseId, course, a }) => {
    const needsSubmission = requiresSubmission(a);
    let submitted = false;
    // Only ask for the submission status when there is something to submit.
    if (needsSubmission) {
      try {
        const s = await call<SubmissionStatusResponse>(
          config,
          "mod_assign_get_submission_status",
          { assignid: a.id },
        );
        const status =
          s.lastattempt?.submission?.status ?? s.lastattempt?.teamsubmission?.status;
        submitted = status === "submitted";
      } catch {
        // Status unavailable (e.g. no permission): treat as not submitted.
      }
    }
    return {
      sourceId: `aims-assign-${a.id}`,
      courseId,
      course,
      title: a.name,
      dueAt: a.duedate ? new Date(a.duedate * 1000).toISOString() : null,
      submitted,
      requiresSubmission: needsSubmission,
      url: `${config.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
    };
  });
}
