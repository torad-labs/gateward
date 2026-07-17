#!/usr/bin/env bun
/**
 * extract_blocks.ts — pull the gate's block messages out of a captured
 * Claude Code session (Bun port of the former Python script).
 *
 * A PreToolUse deny surfaces in the transcript as a tool result whose text
 * starts with `Error:` and carries one or more `[rule-id] line N: ...`
 * messages. We collect those in order, de-duplicated, so each harvested
 * scenario gets a clean `<name>.blocks.txt` beside its full pane capture.
 *
 * Usage: bun extract_blocks.ts <session.jsonl> <out.txt>
 */
const RULE_LINE = /\[[a-z0-9-]+\]\s+line\s+\d+:/;

interface TranscriptRecord {
  toolUseResult?: unknown;
  message?: { content?: Array<{ content?: unknown }> };
}

function* resultTexts(raw: string): Generator<string> {
  for (const line of raw.split("\n")) {
    if (!line.includes("line ") || !line.includes("[")) continue;
    let record: TranscriptRecord;
    try {
      record = JSON.parse(line) as TranscriptRecord;
    } catch {
      continue;
    }
    if (typeof record.toolUseResult === "string") yield record.toolUseResult;
    for (const part of record.message?.content ?? []) {
      if (typeof part?.content === "string") yield part.content;
    }
  }
}

export function extractBlocks(raw: string): string[] {
  const blocks: string[] = [];
  for (const text of resultTexts(raw)) {
    const stripped = text.replace(/^Error:/, "").trim();
    if (RULE_LINE.test(stripped) && !blocks.includes(stripped)) blocks.push(stripped);
  }
  return blocks;
}

if (import.meta.main) {
  const [src, dst] = Bun.argv.slice(2);
  if (!src || !dst) {
    console.error("usage: bun extract_blocks.ts <session.jsonl> <out.txt>");
    process.exit(1);
  }
  const blocks = extractBlocks(await Bun.file(src).text());
  const body = blocks.length ? blocks.join("\n\n") : "no gate denials found in transcript\n";
  await Bun.write(dst, `── GATE BLOCK MESSAGES ──\n\n${body}\n`);
  console.log(`  ${blocks.length} block message(s) -> ${dst}`);
}
