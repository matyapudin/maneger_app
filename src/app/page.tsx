import { Suspense } from "react";
import {
  assignmentState,
  countHidden,
  getConnectedAccount,
  getServiceToken,
  getSetting,
  listAssignments,
  listEmails,
  listTasks,
} from "@/lib/db";
import { requestTime } from "@/lib/format";
import { GMAIL_PRIMARY_ONLY_KEY, getGoogleConfig } from "@/lib/google";
import { AIMS_SERVICE } from "@/lib/moodle";
import { AimsPanel } from "@/components/aims-panel";
import { CalendarPanel } from "@/components/calendar-panel";
import { MailPanel } from "@/components/mail-panel";
import { TasksBand } from "@/components/tasks-band";
import { TopBar } from "@/components/top-bar";

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const week = Number((await searchParams).week ?? 0);
  const weekOffset = Number.isInteger(week) && Math.abs(week) <= 104 ? week : 0;

  const [tasks, emails, assignments, hiddenEmails, hiddenAssignments, gmailAccount] =
    await Promise.all([
      listTasks(),
      listEmails(),
      listAssignments(),
      countHidden("emails"),
      countHidden("assignments"),
      getConnectedAccount("google"),
    ]);
  const now = requestTime();
  const openTasks = tasks.filter((t) => !t.done);
  const pending = assignments.filter((a) => assignmentState(a) === "pending");
  const gmailConnected = getGoogleConfig() !== null && gmailAccount !== null;

  return (
    <div className="flex h-screen min-h-[640px] flex-col gap-[var(--gap)] p-[var(--gap)]">
      <TopBar pendingAssignments={pending} openTasks={openTasks} now={now} />
      <TasksBand tasks={openTasks} now={now} />
      <div className="grid min-h-0 flex-1 grid-cols-[1.55fr_1fr] grid-rows-2 gap-[var(--gap)]">
        <MailPanel
          emails={emails}
          connected={gmailConnected}
          primaryOnly={getSetting(GMAIL_PRIMARY_ONLY_KEY) === "1"}
          hiddenCount={hiddenEmails}
          now={now}
        />
        <div className="row-span-2 grid min-h-0">
          <AimsPanel
            assignments={assignments}
            connected={getServiceToken(AIMS_SERVICE) !== null}
            hiddenCount={hiddenAssignments}
            now={now}
          />
        </div>
        <CalendarPanel assignments={pending} tasks={openTasks} now={now} weekOffset={weekOffset} />
      </div>
    </div>
  );
}

export default function Home(props: PageProps<"/">) {
  return (
    <Suspense
      fallback={<div className="grid h-screen place-items-center text-sm muted">読み込み中…</div>}
    >
      <Dashboard searchParams={props.searchParams} />
    </Suspense>
  );
}
