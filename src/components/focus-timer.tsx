"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A Pomodoro-style focus timer: work, then a short break. State lives in this
// browser (localStorage), so a reload keeps the countdown going.

type Mode = "work" | "break";
type Preset = { work: number; break: number }; // minutes

const PRESETS: Preset[] = [
  { work: 25, break: 5 },
  { work: 50, break: 10 },
  { work: 15, break: 3 },
];

type State = {
  mode: Mode;
  preset: number; // index into PRESETS
  endsAt: number | null; // running: when this period ends (ms)
  remaining: number; // paused: ms left
  doneDate: string; // YYYY-MM-DD the count below belongs to
  doneCount: number; // work periods finished today
};

const KEY = "maneger.focusTimer";
const minutes = (s: State, mode = s.mode) => PRESETS[s.preset][mode] * 60_000;

function today() {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function initial(): State {
  return { mode: "work", preset: 0, endsAt: null, remaining: 25 * 60_000, doneDate: today(), doneCount: 0 };
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...initial(), ...(JSON.parse(raw) as Partial<State>) };
      if (!PRESETS[s.preset]) s.preset = 0;
      if (s.doneDate !== today()) return { ...s, doneDate: today(), doneCount: 0 };
      return s;
    }
  } catch {
    // Storage blocked or corrupt: start fresh.
  }
  return initial();
}

function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not saved; the timer still works for this page.
  }
}

function fmt(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// A short two-tone chime (no audio file needed).
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.35;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  } catch {
    // Audio unavailable.
  }
}

function notify(text: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Manager", { body: text });
    }
  } catch {
    // Notifications unavailable.
  }
}

export function FocusTimer() {
  const [state, setState] = useState<State | null>(null); // null until loaded
  const [now, setNow] = useState(0);
  const baseTitle = useRef("");

  // Load saved state after mount (the server can't read localStorage).
  useEffect(() => {
    baseTitle.current = document.title;
    const id = requestAnimationFrame(() => {
      setState(load());
      setNow(Date.now());
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const update = useCallback((fn: (s: State) => State) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  // Tick while running; finish the period when time is up.
  useEffect(() => {
    if (!state?.endsAt) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (state.endsAt !== null && t >= state.endsAt) {
        const finishedWork = state.mode === "work";
        chime();
        notify(finishedWork ? "お疲れさまです。休憩しましょう。" : "休憩終了。作業に戻りましょう。");
        update((s) => {
          const mode: Mode = finishedWork ? "break" : "work";
          return {
            ...s,
            mode,
            endsAt: null,
            remaining: minutes(s, mode),
            doneCount: finishedWork ? s.doneCount + 1 : s.doneCount,
          };
        });
      }
    }, 500);
    return () => clearInterval(id);
  }, [state?.endsAt, state?.mode, update]);

  const running = state?.endsAt != null;
  const left = state ? (running ? state.endsAt! - now : state.remaining) : 0;

  // Show the countdown in the browser tab while running.
  useEffect(() => {
    if (!state) return;
    document.title = running
      ? `${fmt(left)} ${state.mode === "work" ? "作業" : "休憩"} - ${baseTitle.current}`
      : baseTitle.current;
  }, [running, left, state]);

  if (!state) {
    return <div className="h-8 w-[230px]" aria-hidden />;
  }

  const start = () => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    update((s) => ({ ...s, endsAt: Date.now() + s.remaining }));
    setNow(Date.now());
  };
  const pause = () => update((s) => ({ ...s, endsAt: null, remaining: Math.max(0, s.endsAt! - Date.now()) }));
  const reset = () => update((s) => ({ ...s, endsAt: null, remaining: minutes(s) }));
  const switchMode = () =>
    update((s) => {
      const mode: Mode = s.mode === "work" ? "break" : "work";
      return { ...s, mode, endsAt: null, remaining: minutes(s, mode) };
    });
  const setPreset = (i: number) =>
    update((s) => ({ ...s, preset: i, endsAt: null, remaining: PRESETS[i][s.mode] * 60_000 }));

  const isWork = state.mode === "work";
  return (
    <div
      className="flex h-8 items-center border border-[var(--line)] bg-white/60 text-[13px]"
      title="集中タイマー"
    >
      <button
        type="button"
        onClick={switchMode}
        className={`h-full px-2 text-xs font-semibold ${isWork ? "bg-[var(--accent)] text-white" : "bg-[#10b981] text-white"}`}
        title="作業 / 休憩を切り替える"
      >
        {isWork ? "作業" : "休憩"}
      </button>
      <span className="w-[52px] text-center font-semibold tabular-nums" aria-live="off">
        {fmt(left)}
      </span>
      <button
        type="button"
        onClick={running ? pause : start}
        className="grid h-full w-7 place-items-center hover:bg-white"
        aria-label={running ? "一時停止" : "スタート"}
        title={running ? "一時停止" : "スタート"}
      >
        {running ? "❚❚" : "▶"}
      </button>
      <button
        type="button"
        onClick={reset}
        className="grid h-full w-7 place-items-center muted hover:bg-white"
        aria-label="リセット"
        title="リセット"
      >
        ↺
      </button>
      <select
        value={state.preset}
        onChange={(e) => setPreset(Number(e.target.value))}
        className="h-full border-l border-[var(--line)] bg-transparent px-1 text-xs muted"
        aria-label="時間の組み合わせ"
        title="作業 / 休憩の長さ"
      >
        {PRESETS.map((p, i) => (
          <option key={i} value={i}>
            {p.work}/{p.break}分
          </option>
        ))}
      </select>
      <span className="border-l border-[var(--line)] px-2 text-xs muted" title="今日終えた作業の回数">
        今日 {state.doneCount} 回
      </span>
    </div>
  );
}
