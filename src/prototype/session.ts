/* Sync/session state, separate from the work-paper store: backend mode,
   task list, save status. Same subscribe/getSnapshot pattern. */

import type { TaskRow } from "./api";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export type SessionState = {
  remote: boolean;
  connected: boolean | null;        // null = probing
  tasks: TaskRow[];
  saveState: SaveState;
  lastSavedAt: string | null;
  /** entity client id -> server workpaper id */
  workpaperIds: Record<string, string>;
};

let state: SessionState = {
  remote: false,
  connected: null,
  tasks: [],
  saveState: "idle",
  lastSavedAt: null,
  workpaperIds: {},
};

const listeners = new Set<() => void>();

export function sessionSubscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const sessionSnapshot = () => state;
export function setSession(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
