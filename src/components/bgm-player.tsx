"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseYouTube } from "@/lib/youtube";

// Work music from YouTube, controlled from the app (play / pause, next,
// previous, volume) through the YouTube IFrame Player API:
// https://developers.google.com/youtube/iframe_api_reference
//
// YouTube's terms require the embedded player to stay visible (at least
// 200x200), so the video plays in a small window at the bottom right while
// the controls sit in the top bar. Closing the window stops the music.

type Station = { name: string; embed: string; builtIn?: boolean };

// Long-running "music to study to" live streams. If one has ended, add your
// own station from any YouTube URL (a playlist gives real next / previous).
const BUILT_IN: Station[] = [
  { name: "lofi hip hop radio（Lofi Girl）", embed: "jfKfPfyJRdk", builtIn: true },
  { name: "synthwave radio（Lofi Girl）", embed: "4xDzrJKXOOY", builtIn: true },
];

const KEY = "maneger.bgm";

// ---------- Minimal types for the parts of the YouTube API we use ----------

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  previousVideo(): void;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  loadVideoById(id: string): void;
  loadPlaylist(args: { list: string; listType: "playlist" }): void;
  getVideoData?(): { title?: string; author?: string };
  destroy(): void;
};

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      width: number;
      height: number;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const BUFFERING = 3;

let apiPromise: Promise<YTNamespace> | null = null;

// Loads https://www.youtube.com/iframe_api once per page.
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT!);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        apiPromise = null;
        reject(new Error("YouTube を読み込めませんでした"));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

// ---------- Saved choices (this browser only) ----------

type Saved = { custom: Station[]; selected: string; volume: number; muted: boolean };

const DEFAULTS: Saved = { custom: [], selected: BUILT_IN[0].embed, volume: 60, muted: false };

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>;
      return {
        custom: Array.isArray(s.custom) ? s.custom : [],
        selected: s.selected ?? DEFAULTS.selected,
        volume: typeof s.volume === "number" ? Math.min(100, Math.max(0, s.volume)) : DEFAULTS.volume,
        muted: s.muted === true,
      };
    }
  } catch {
    // Storage blocked or corrupt.
  }
  return DEFAULTS;
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not saved; works for this page only.
  }
}

// Error codes from the player: the video is gone, private, or can't be embedded.
function errorMessage(code: number) {
  if (code === 101 || code === 150) return "この動画は埋め込み再生が許可されていません。";
  if (code === 100) return "動画が見つかりません（終了・削除された可能性があります）。";
  return "再生できませんでした。";
}

const iconBtn =
  "grid h-full w-7 place-items-center text-[12px] hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent";

export function BgmPlayer() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Saved>(DEFAULTS);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [title, setTitle] = useState("");
  const [playerError, setPlayerError] = useState<string | null>(null);

  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  // Latest saved choices for the player's event handlers.
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setSaved(load()));
    return () => cancelAnimationFrame(id);
  }, []);

  const change = useCallback((next: Saved) => {
    savedRef.current = next;
    setSaved(next);
    save(next);
  }, []);

  const stations = [...BUILT_IN, ...saved.custom];
  const current = stations.find((s) => s.embed === saved.selected) ?? BUILT_IN[0];
  const isPlaylist = current.embed.startsWith("list:");

  // Create the player when the window opens; destroy it when it closes.
  useEffect(() => {
    if (!open || !holder.current) return;
    let cancelled = false;
    const box = holder.current;
    // YouTube replaces this element with its iframe; React never touches it.
    const target = document.createElement("div");
    box.appendChild(target);
    const start = savedRef.current;
    const first = [...BUILT_IN, ...start.custom].find((s) => s.embed === start.selected) ?? BUILT_IN[0];

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        const list = first.embed.startsWith("list:") ? first.embed.slice(5) : null;
        player.current = new YT.Player(target, {
          host: "https://www.youtube-nocookie.com",
          width: 356,
          height: 200,
          ...(list ? {} : { videoId: first.embed }),
          playerVars: {
            autoplay: 1,
            playsinline: 1,
            rel: 0,
            ...(list ? { listType: "playlist", list } : {}),
          },
          events: {
            onReady: (e) => {
              const s = savedRef.current;
              e.target.setVolume(s.volume);
              if (s.muted) e.target.mute();
              e.target.playVideo();
              setReady(true);
            },
            onStateChange: (e) => {
              setPlaying(e.data === PLAYING || e.data === BUFFERING);
              if (e.data === PLAYING) {
                setPlayerError(null);
                const d = e.target.getVideoData?.();
                if (d?.title) setTitle(d.title);
              }
            },
            onError: (e) => {
              setPlaying(false);
              setPlayerError(errorMessage(e.data));
            },
          },
        });
      })
      .catch((err: Error) => !cancelled && setPlayerError(err.message));

    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      box.innerHTML = "";
      setReady(false);
      setPlaying(false);
      setTitle("");
      setPlayerError(null);
    };
  }, [open]);

  // Switch the running player to another station.
  const selectStation = useCallback(
    (embed: string) => {
      change({ ...savedRef.current, selected: embed });
      const p = player.current;
      if (!p) return;
      setTitle("");
      setPlayerError(null);
      if (embed.startsWith("list:")) p.loadPlaylist({ list: embed.slice(5), listType: "playlist" });
      else p.loadVideoById(embed);
    },
    [change],
  );

  const stepStation = (dir: 1 | -1) => {
    const i = stations.findIndex((s) => s.embed === current.embed);
    selectStation(stations[(i + dir + stations.length) % stations.length].embed);
  };

  // In a playlist: next / previous song. A live stream has no next song, so
  // the buttons move to the next / previous station instead.
  const next = () => (isPlaylist ? player.current?.nextVideo() : stepStation(1));
  const prev = () => (isPlaylist ? player.current?.previousVideo() : stepStation(-1));
  const toggle = () => (playing ? player.current?.pauseVideo() : player.current?.playVideo());

  const setVolume = (v: number) => {
    player.current?.setVolume(v);
    if (v > 0 && saved.muted) player.current?.unMute();
    change({ ...saved, volume: v, muted: v === 0 ? saved.muted : false });
  };
  const toggleMute = () => {
    if (saved.muted) player.current?.unMute();
    else player.current?.mute();
    change({ ...saved, muted: !saved.muted });
  };

  const addStation = () => {
    const embed = parseYouTube(url);
    if (!embed) {
      setFormError("YouTube の動画・ライブ・再生リストの URL を貼ってください。");
      return;
    }
    const station = { name: name.trim() || "マイステーション", embed };
    change({ ...saved, custom: [...saved.custom.filter((s) => s.embed !== embed), station] });
    selectStation(embed);
    setAdding(false);
    setUrl("");
    setName("");
    setFormError(null);
  };

  const removeStation = (embed: string) => {
    const custom = saved.custom.filter((s) => s.embed !== embed);
    change({ ...saved, custom });
    if (saved.selected === embed) selectStation(BUILT_IN[0].embed);
  };

  const nextLabel = isPlaylist ? "次の曲" : "次のステーション";
  const prevLabel = isPlaylist ? "前の曲" : "前のステーション";
  const nowPlaying = playerError ?? (title || current.name);

  return (
    <>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn" title="作業用 BGM を流す">
          ♪ BGM
        </button>
      ) : (
        // Controls in the top bar while the BGM window is open.
        <div
          className="flex h-8 items-center border border-[var(--accent)] bg-white/70 text-[13px]"
          role="group"
          aria-label="BGM の操作"
        >
          <button type="button" onClick={prev} disabled={!ready} className={iconBtn} aria-label={prevLabel} title={prevLabel}>
            ⏮
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={!ready}
            className="grid h-full w-8 place-items-center bg-[var(--accent)] text-white hover:bg-[#005aa8] disabled:opacity-60"
            aria-label={playing ? "一時停止" : "再生"}
            title={playing ? "一時停止" : "再生"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button type="button" onClick={next} disabled={!ready} className={iconBtn} aria-label={nextLabel} title={nextLabel}>
            ⏭
          </button>
          <span
            className={`w-[96px] truncate px-2 text-xs 2xl:w-[150px] ${playerError ? "danger" : ""}`}
            title={nowPlaying}
            aria-live="polite"
          >
            {nowPlaying}
          </span>
          <button
            type="button"
            onClick={toggleMute}
            className={iconBtn}
            aria-label={saved.muted ? "消音を解除" : "消音"}
            title={saved.muted ? "消音を解除" : "消音"}
          >
            {saved.muted || saved.volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={saved.muted ? 0 : saved.volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="mr-2 w-[56px] accent-[var(--accent)] 2xl:w-[80px]"
            aria-label="音量"
            title={`音量 ${saved.volume}`}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid h-full w-7 place-items-center border-l border-[var(--line)] muted hover:bg-white"
            aria-label="BGM を止めて閉じる"
            title="止めて閉じる"
          >
            ×
          </button>
        </div>
      )}

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
                onChange={(e) => selectStation(e.target.value)}
                className="input flex-1"
                aria-label="ステーション"
              >
                {stations.map((s) => (
                  <option key={s.embed} value={s.embed}>
                    {s.embed.startsWith("list:") ? "▤ " : ""}
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
                {formError && <p className="text-xs danger">{formError}</p>}
                <p className="text-[11px] muted">再生リストの URL を追加すると、⏭ ⏮ で曲を送れます。</p>
              </div>
            )}
            {/* 356x200: YouTube asks for an embedded player of at least 200x200. */}
            <div ref={holder} className="h-[200px] w-[356px] bg-black" />
            <p className="text-[11px] muted">
              {isPlaylist
                ? "再生リスト：⏭ ⏮ で次の曲・前の曲に移ります。"
                : "ライブ配信：⏭ ⏮ で次・前のステーションに切り替わります。"}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
