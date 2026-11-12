const dateTimeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

export function formatDateTime(iso: string) {
  return dateTimeFmt.format(new Date(iso));
}

export function formatDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

// A task's due date ("YYYY-MM-DD") means the end of that day in Japan time.
export function taskDueToIso(date: string) {
  return new Date(`${date}T23:59:59+09:00`).toISOString();
}

// "Taro <taro@example.com>" -> "Taro"
export function displayName(from: string) {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return m ? m[1] : from;
}
