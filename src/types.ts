export type NoteType = "md" | "txt" | "markdown";
export type NoteKind = "markdown" | "qa" | "study" | "code";
export interface NoteMeta {
  path: string;
  title: string;
  type: NoteType;
  noteType?: NoteKind;
  folder: string;
  modifiedAt: number;
  preview: string;
  content: string;
  revision: string;
}
export interface Note extends NoteMeta {}
export interface Preferences {
  theme: "system" | "light" | "dark";
  restoreLastNote: boolean;
  defaultType: "md" | "txt";
  fontSize: number;
  fontFamily: "system" | "serif" | "mono";
  sidebarWidth: number;
  listWidth: number;
  sidebarCollapsed: boolean;
  lastNote: string | null;
}
export interface AppConfig {
  root: string;
  layoutVersion?: number;
  favorites: string[];
  preferences: Preferences;
  noteTypes?: Record<string, NoteKind>;
}
export interface Snapshot {
  config: AppConfig;
  notes: NoteMeta[];
  folders: string[];
  warnings: string[];
}
export interface StorageAPI {
  snapshot(): Promise<Snapshot>;
  readAsset(path: string): Promise<string>;
  readNote(path: string): Promise<Note>;
  createNote(
    type: "md" | "txt",
    folder?: string,
    templateId?: string,
  ): Promise<Note>;
  saveNote(path: string, content: string, revision: string): Promise<Note>;
  renameNote(path: string, title: string, revision: string): Promise<Note>;
  deleteNote(path: string, revision: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  renameFolder(path: string, name: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
  toggleFavorite(path: string): Promise<AppConfig>;
  updatePreferences(patch: Partial<Preferences>): Promise<AppConfig>;
  changeRoot(
    path: string,
    migrate: boolean,
    create?: boolean,
  ): Promise<Snapshot>;
}
export type WindowAction = "close" | "minimize" | "fullscreen" | "zoom";
export interface DesktopAPI extends StorageAPI {
  windowControls?: { perform(action: WindowAction): Promise<void> };
  chooseDirectory(): Promise<string | null>;
  openDirectory(): Promise<void>;
  onBeforeClose(handler: () => Promise<boolean>): () => void;
}
declare global {
  interface Window {
    xnote?: DesktopAPI;
  }
}
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  restoreLastNote: true,
  defaultType: "md",
  fontSize: 14,
  fontFamily: "system",
  sidebarWidth: 200,
  listWidth: 300,
  sidebarCollapsed: false,
  lastNote: null,
};
