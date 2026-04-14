import { create } from 'zustand';
import type { WorkspaceSummary } from '@llm-wiki/shared';

interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  currentWorkspace: WorkspaceSummary | null;
  setWorkspaces: (workspaces: WorkspaceSummary[]) => void;
  setCurrentWorkspace: (workspace: WorkspaceSummary | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  currentWorkspace: null,
  setWorkspaces: (workspaces) => set({ workspaces }),
  setCurrentWorkspace: (currentWorkspace) => set({ currentWorkspace }),
}));
