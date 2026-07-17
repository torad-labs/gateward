/**
 * Reconstruct the file content a tool call would produce, without writing it.
 *
 * The gate judges the *projected* content, never the raw edit instruction:
 * Write supplies the whole file; Edit is replayed against the current on-disk
 * file. When the outcome is undecidable — an Edit whose `old_string` is not
 * in the file, or a missing file — the gate declines to judge. The harness
 * will reject that edit on its own, and we never double-judge.
 */

export const WRITE = "Write";
export const EDIT = "Edit";

export interface ToolInput {
  file_path?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

/** The before/after content of a decidable, gated tool call. */
export interface Projection {
  path: string;
  toolName: string;
  /** On-disk content before the call ("" for a new file). */
  current: string;
  /** Content the call would produce. */
  projected: string;
}

/** Return a Projection, or null when the call is not ours or is undecidable. */
export async function project(toolName: string, toolInput: ToolInput): Promise<Projection | null> {
  const path = toolInput.file_path;
  if (!path) return null;

  if (toolName === WRITE) {
    const { content } = toolInput;
    if (content === undefined || content === null) return null;
    const current = await read(path);
    return { path, toolName: WRITE, current: current ?? "", projected: content };
  }

  if (toolName === EDIT) {
    const oldString = toolInput.old_string;
    if (!oldString) return null; // empty/missing anchor -> undecidable
    const current = await read(path);
    if (current === null || !current.includes(oldString)) {
      return null; // missing file, or a stale anchor -> undecidable
    }
    const newString = toolInput.new_string ?? "";
    const projected = toolInput.replace_all
      ? current.replaceAll(oldString, newString)
      : current.replace(oldString, newString);
    return { path, toolName: EDIT, current, projected };
  }

  return null;
}

async function read(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null; // missing file or a directory
    return await file.text();
  } catch {
    return null;
  }
}
