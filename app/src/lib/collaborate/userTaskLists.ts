const STORAGE_KEY = 'colab_user_task_lists';
const LIST_TAG_PREFIX = 'list:';

export type TaggedTask = { tags: string[] };

export function taskListName(task: TaggedTask): string {
  const tag = task.tags.find((value) => value.startsWith(LIST_TAG_PREFIX));
  const name = tag?.slice(LIST_TAG_PREFIX.length).trim();
  return name || 'My Tasks';
}

export function isMyTasksTask(task: TaggedTask): boolean {
  return taskListName(task) === 'My Tasks';
}

export function withTaskListTag(tags: string[], listName: string): string[] {
  const next = tags.filter((tag) => !tag.startsWith(LIST_TAG_PREFIX));
  const name = String(listName || '').trim();
  if (name && name !== 'My Tasks') next.push(`${LIST_TAG_PREFIX}${name}`);
  return next;
}

export function taskListsFromTags(tasks: TaggedTask[]): string[] {
  return [...new Set(tasks.map(taskListName).filter((name) => name !== 'My Tasks'))];
}

export function loadUserTaskLists(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => String(x || '').trim())
      .filter((name) => name && name !== 'My Tasks');
  } catch {
    return [];
  }
}

export function saveUserTaskList(name: string) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === 'My Tasks') return;
  const lists = loadUserTaskLists();
  if (lists.includes(trimmed)) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...lists, trimmed]));
}

export function removeUserTaskList(name: string) {
  const trimmed = String(name || '').trim();
  const lists = loadUserTaskLists().filter((n) => n !== trimmed);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
}

export function renameUserTaskList(oldName: string, newName: string) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  if (!from || !to || from === 'My Tasks' || to === 'My Tasks') return false;
  const lists = loadUserTaskLists().filter((n) => n !== from);
  if (!lists.includes(to)) lists.push(to);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  return true;
}
