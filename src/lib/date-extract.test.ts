// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDates } from "./date-extract.ts";

// Email received and read on 2026-11-12 (Thu) 10:00 Japan time.
const RECEIVED = Date.parse("2026-11-12T10:00:00+09:00");
const NOW = RECEIVED;
const find = (text: string, received = RECEIVED, now = NOW) =>
  extractDates(text, received, now).map((f) => `${f.date}${f.time ? ` ${f.time}` : ""} ${f.kind}`);

test("Japanese month-day with weekday and time, deadline", () => {
  assert.deepEqual(find("11月20日（金）17時までに AIMS から提出してください。"), [
    "2026-11-20 17:00 deadline",
  ]);
});

test("slash date with colon time, event", () => {
  assert.deepEqual(find("説明会は 11/25 13:30 から研究棟で開催します"), [
    "2026-11-25 13:30 event",
  ]);
});

test("full date with year, and 午後 / 半", () => {
  assert.deepEqual(find("2026年12月3日 午後5時半 締切"), ["2026-12-03 17:30 deadline"]);
  assert.deepEqual(find("期限: 2026/12/01"), ["2026-12-01 deadline"]);
});

test("full-width digits and slash", () => {
  assert.deepEqual(find("提出期限は１１／２０です"), ["2026-11-20 deadline"]);
});

test("a range gives both dates", () => {
  assert.deepEqual(find("11/18 から 11/22 まで、履修内容の確認ができます。"), [
    "2026-11-18 event",
    "2026-11-22 deadline",
  ]);
});

test("past dates are not suggested", () => {
  assert.deepEqual(find("貸出中の資料の返却期限は 11/10 です。"), []);
});

test("a date without a year early in the next year", () => {
  const dec = Date.parse("2026-12-20T10:00:00+09:00");
  assert.deepEqual(find("レポートは 1/15 までに提出", dec, dec), ["2027-01-15 deadline"]);
});

test("明日 only with a deadline word or a time", () => {
  assert.deepEqual(find("明日までに出欠を返信してください"), ["2026-11-13 deadline"]);
  assert.deepEqual(find("明日 10時 から集合"), ["2026-11-13 10:00 event"]);
  assert.deepEqual(find("明日のゼミはよろしくお願いします"), []);
});

test("URLs, fractions-like versions and impossible dates are ignored", () => {
  assert.deepEqual(find("詳細は https://example.com/2026/11/30/news を見てください"), []);
  assert.deepEqual(find("2月30日は存在しない"), []);
  assert.deepEqual(find("バージョン 1.2/3 をリリース"), []);
});

test("duplicates are merged and at most 3 are returned", () => {
  const text = "11/20 締切。再掲：11月20日 締切。11/21, 11/22, 11/23, 11/24";
  const r = find(text);
  assert.equal(r.length, 3);
  assert.equal(r[0], "2026-11-20 deadline");
  assert.equal(new Set(r).size, 3);
});

test("24時 means the end of that day", () => {
  assert.deepEqual(find("11月20日24時締切"), ["2026-11-20 23:00 deadline"]);
});
