/** Ephemeral handoff from project composer → Agent Sam first send (same-tab File refs). */

let pendingFiles: File[] = [];

export function stashProjectChatFiles(files: File[]): void {
  pendingFiles = files.filter((f) => f instanceof File);
}

export function takeProjectChatFiles(): File[] {
  const files = pendingFiles;
  pendingFiles = [];
  return files;
}
