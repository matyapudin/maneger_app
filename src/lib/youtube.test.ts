// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYouTube } from "./youtube.ts";

test("video, live, short and youtu.be links give the video ID", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    "https://www.youtube.com/watch?v=jfKfPfyJRdk&t=30s",
    "https://youtube.com/live/jfKfPfyJRdk?si=abc",
    "https://youtu.be/jfKfPfyJRdk",
    "https://www.youtube.com/embed/jfKfPfyJRdk",
    "https://m.youtube.com/shorts/jfKfPfyJRdk",
    "jfKfPfyJRdk",
  ]) {
    assert.equal(parseYouTube(url), "jfKfPfyJRdk", url);
  }
});

test("playlist links give list:<id>", () => {
  assert.equal(
    parseYouTube("https://www.youtube.com/playlist?list=PLabc_DEF-123"),
    "list:PLabc_DEF-123",
  );
});

test("other sites and junk are rejected", () => {
  assert.equal(parseYouTube("https://evil.example.com/watch?v=jfKfPfyJRdk"), null);
  assert.equal(parseYouTube("https://notyoutube.com/watch?v=jfKfPfyJRdk"), null);
  assert.equal(parseYouTube("hello"), null);
  assert.equal(parseYouTube("javascript:alert(1)"), null);
});
