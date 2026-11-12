// Minimal client for the Moodle web service API (AIMS runs on Moodle).
// Docs: https://docs.moodle.org/dev/Web_service_API_functions

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

// Reads MOODLE_BASE_URL and MOODLE_TOKEN (set them in .env.local).
export function getMoodleConfig(): MoodleConfig | null {
  const baseUrl = process.env.MOODLE_BASE_URL?.trim().replace(/\/+$/, "");
  const token = process.env.MOODLE_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
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
  course: string;
  title: string;
  dueAt: string | null; // ISO 8601 (UTC)
  submitted: boolean;
  url: string;
};

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
    c.assignments.map((a) => ({ course: c.fullname, a })),
  );

  return mapWithLimit(flat, 5, async ({ course, a }) => {
    let submitted = false;
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
    return {
      sourceId: `aims-assign-${a.id}`,
      course,
      title: a.name,
      dueAt: a.duedate ? new Date(a.duedate * 1000).toISOString() : null,
      submitted,
      url: `${config.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
    };
  });
}
