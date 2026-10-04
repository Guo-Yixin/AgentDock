export type Provider = 'codex' | 'claude' | 'cursor' | 'pi' | 'deepseek' | 'workbuddy';
export type Completion = 'unconfirmed' | 'in_progress' | 'blocked' | 'done' | 'reported_complete';
export interface Evidence { path: string; line?: number; locator?: string }
export interface Todo { text: string; status: string }
export interface TaskEvent { timestamp: number; kind: string; text: string; evidence: Evidence }
export interface Annotation { note: string; summaryOverride: string | null; manualStatus: Exclude<Completion, 'reported_complete'> | null; goalGroup: string; pinned: boolean; branchId?: string; needsReview?: boolean }
export interface Task {
  id: string; nativeId: string; provider: Provider; surface: string; title: string; goal: string;
  projectId: string; projectName: string; cwd: string; createdAt: number; updatedAt: number;
  activity: 'recent' | 'responded' | 'interrupted' | 'unknown'; completion: Completion;
  summary: string; summaryEvidence: Evidence | null; todos: Todo[]; archived: boolean;
  branches?: {id: string; summary: string; goal: string}[]; inferredBranch?: string; partial: boolean; evidence: Evidence; annotation: Annotation; events?: TaskEvent[];
}
export interface Project { id: string; name: string; root: string; count: number; updatedAt: number; providers: Provider[] }
export interface Source {
  id: Provider; name: string; state: 'ready' | 'scanning' | 'partial' | 'missing' | 'planned' | 'error' | 'paused';
  count: number; syncAt: number | null; message: string; locations: string[];
}
export interface Overview {
  total: number; recent: number; needsAttention: number; today: number; doneToday: number;
  projects: Project[]; sources: Source[]; hourly: number[]; importing: boolean;
  importProgress: { completed: number; total: number }; updatedAt: number;
}
export interface TaskPage { tasks: Task[]; total: number; page: number; pageSize: number }
