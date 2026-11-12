"use client";

import { useEffect, useState } from "react";
import { parseYouTube } from "@/lib/youtube";

// Work music from YouTube. YouTube's terms require the embedded player to stay
// visible (at least 200x200), so it plays in a small window at the bottom
// right; closing the window stops the music.

type Station = { name: string; embed: string; builtIn?: boolean };

// Long-running "music to study to" live streams. If one has ended, add your
// own station from any YouTube URL.
const BUILT_IN: Station[] = [
  { name: "lofi hip hop radio（Lofi Girl）", embed: "jfKfPfyJRdk", builtIn: true },
  { name: "synthwave radio（Lofi Girl）", embed: "4xDzrJKXOOY", builtIn: true },
];

const KEY = "maneger.bgm";

function embedUrl(embed: string) {
  const base = "https://www.youtube-nocookie.com/embed/";
  return embed.startsWith("list:")
    ? `${base}videoseries?list=${encodeURIComponent(embed.slice(5))}&autoplay=1`
    : `${base}${encodeURIComponent(embed)}?autoplay=1`;
}

type Saved = { custom: Station[]; selected: string };

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>;
      return { custom: Array.isArray(s.custom) ? s.custom : [], selected: s.selected ?? BUILT_IN[0].embed };
    }
  } catch {
    // Storage blocked or corrupt.
  }
  return { custom: [], selected: BUILT_IN[0].embed };
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not saved; works for this page only.
  }
}

export function BgmPlayer() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Saved>({ custom: [], selected: BUILT_IN[0].embed });
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setSaved(load()));
    return () => cancelAnimationFrame(id);
  }, []);

  const change = (next: Saved) => {
    setSaved(next);
    save(next);
  };

  const stations = [...BUILT_IN, ...saved.custom];
  const current = stations.find((s) => s.embed === saved.selected) ?? BUILT_IN[0];

  const addStation = () => {
    const embed = parseYouTube(url);
    if (!embed) {
      setError("YouTube の動画・ライブ・再生リストの URL を貼ってください。");
      return;
    }
    const station = { name: name.trim() || "マイステーション", embed };
    change({ custom: [...saved.custom.filter((s) => s.embed !== embed), station], selected: embed });
    setAdding(false);
    setUrl("");
    setName("");
    setError(null);
  };

  const removeStation = (embed: string) =>
    change({
      custom: saved.custom.filter((s) => s.embed !== embed),
      selected: saved.selected === embed ? BUILT_IN[0].embed : saved.selected,
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`btn ${open ? "btn-primary" : ""}`}
        title={open ? "BGM を止める" : "作業用 BGM を流す"}
        aria-pressed={open}
      >
        ♪ BGM
      </button>
      {open && (
        <div
          className="glass fixed right-[var(--gap)] bottom-[var(--gap)] z-50 flex w-[380px] flex-col"
          role="dialog"
          aria-label="作業用 BGM"
        >
          <div className="panel-head">
            <span className="panel-title text-[13px]">♪ 作業用 BGM</span>
            <span className="panel-right">
              <button type="button" onClick={() => setOpen(false)} className="btn btn-xs" title="閉じると止まります">
                閉じる（停止）
              </button>
            </span>
          </div>
          <div className="flex flex-col gap-2 bg-white p-3">
            <div className="flex gap-2">
              <select
                value={current.embed}
                onChange={(e) => change({ ...saved, selected: e.target.value })}
                className="input flex-1"
                aria-label="ステーション"
              >
                {stations.map((s) => (
                  <option key={s.embed} value={s.embed}>
                    {s.name}
                  </option>
                ))}
              </select>
              {!current.builtIn && (
                <button type="button" onClick={() => removeStation(current.embed)} className="btn" title="このステーションを削除">
                  削除
                </button>
              )}
              <button type="button" onClick={() => setAdding((a) => !a)} className="btn" title="YouTube の URL から追加">
                ＋
              </button>
            </div>
            {adding && (
              <div className="flex flex-col gap-1.5 border border-[var(--line)] bg-[var(--surface-2)] p-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="YouTube の URL（動画・ライブ・再生リスト）"
                  className="input"
                  aria-label="YouTube の URL"
                />
                <div className="flex gap-1.5">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="名前（省略可）"
                    className="input flex-1"
                    aria-label="名前"
                  />
                  <button type="button" onClick={addStation} className="btn btn-primary">
                    追加
                  </button>
                </div>
                {error && <p className="text-xs danger">{error}</p>}
              </div>
            )}
            {/* 356x200: YouTube asks for an embedded player of at least 200x200. */}
            <iframe
              key={current.embed}
              src={embedUrl(current.embed)}
              title={current.name}
              width={356}
              height={200}
              className="h-[200px] w-[356px] bg-black"
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
            />
            <p className="text-[11px] muted">
              音量は動画の上で調整できます。流れないときは、別のステーションを選ぶか「＋」から追加してください。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
