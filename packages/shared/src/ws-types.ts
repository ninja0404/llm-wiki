export type WsMessage =
  | WsIngestProgress
  | WsWikiPageUpdated
  | WsWikiPageCreated
  | WsBudgetAlert
  | WsWorkerStatus
  | WsFlaggedAlert
  | WsLintCompleted
  | WsError;

export interface WsIngestProgress {
  type: 'ingest:progress';
  payload: {
    sourceId: string;
    totalBatches: number;
    completedBatches: number;
    failedBatches: number[];
    status: string;
  };
}

export interface WsWikiPageUpdated {
  type: 'wiki:page:updated';
  payload: {
    pageId: string;
    title: string;
    changeType: string;
  };
}

export interface WsWikiPageCreated {
  type: 'wiki:page:created';
  payload: {
    pageId: string;
    title: string;
    slug: string;
  };
}

export interface WsBudgetAlert {
  type: 'budget:alert';
  payload: {
    workspaceId: string;
    usagePercent: number;
    tokensUsed: number;
    tokensBudget: number;
  };
}

export interface WsWorkerStatus {
  type: 'worker:status';
  payload: {
    workerId: string;
    status: 'idle' | 'busy' | 'error';
    currentJob?: string;
  };
}

export interface WsFlaggedAlert {
  type: 'flagged:alert';
  payload: {
    workspaceId: string;
    pendingCount: number;
  };
}

export interface WsLintCompleted {
  type: 'lint:completed';
  payload: {
    workspaceId: string;
    orphanCount: number;
    brokenLinkCount: number;
    totalPagesScanned: number;
  };
}

export interface WsError {
  type: 'error';
  payload: {
    message: string;
    code?: string;
  };
}
