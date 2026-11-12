"use client";

import { useEffect, useRef, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { refreshAllAction, refreshIfStaleAction } from "@/app/actions";

function Spinner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-icon"
      title="AIMS と Gmail から最新の情報を取り込む"
      aria-label="更新"
      disabled={pending}
    >
      <span className={pending ? "inline-block animate-spin" : "inline-block"}>↻</span>
    </button>
  );
}

// The ↻ button in the top bar.
export function RefreshButton() {
  return (
    <form action={refreshAllAction}>
      <Spinner />
    </form>
  );
}

// When the app opens, refresh in the background if the data is old.
export function AutoRefresh() {
  const started = useRef(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startTransition(async () => {
      await refreshIfStaleAction();
    });
  }, []);
  return pending ? <span className="text-xs muted">更新中…</span> : null;
}
