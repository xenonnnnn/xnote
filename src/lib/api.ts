import type { StorageAPI } from "../types";
export const methods = [
  "snapshot",
  "readAsset",
  "readNote",
  "createNote",
  "saveNote",
  "renameNote",
  "deleteNote",
  "createFolder",
  "renameFolder",
  "deleteFolder",
  "toggleFavorite",
  "updatePreferences",
  "changeRoot",
] as const;
const browserAPI = Object.fromEntries(
  methods.map((method) => [
    method,
    async (...args: unknown[]) => {
      const response = await fetch(`/api/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "文件操作失败，请重试。");
      return result.data;
    },
  ]),
) as unknown as StorageAPI;
export const api: StorageAPI = window.xnote || browserAPI;
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
