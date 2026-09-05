export interface RebuildSourceFeature {
  id: string;
  name: string;
  decision: string;
  unitIds: string[];
  specification: string;
  acceptance: string;
}

export interface RebuildUnit {
  id: string;
  name: string;
  order: number;
  stage: string;
  dependencies: string[];
  design: string;
  frontend: string;
  backend: string;
  acceptance: string;
  deployment: string;
  evidence: string;
  details: Array<{ label: string; text: string }>;
  sourceFeatures: RebuildSourceFeature[];
  taskKinds: string[];
}

export interface RebuildTaskSignal {
  taskKind: string;
  observed: number;
  succeeded: number;
  failed: number;
  other: number;
  latestAt: string;
}

export interface RebuildConfiguration {
  id: string;
  name: string;
  description: string;
  scope: string;
  section: 'agents' | 'prompt-context' | 'memberships' | 'issues' | null;
  unitIds: string[];
}

export interface RebuildControlData {
  source: { version: string; digest: string; updatedAt: string; path: string };
  units: RebuildUnit[];
  sourceFeatures: RebuildSourceFeature[];
  configurations: RebuildConfiguration[];
  runtime: {
    checkedAt: string;
    origin: string;
    releaseId: string;
    database: 'responding';
    worker: 'recent_heartbeat' | 'stale_or_missing';
    heartbeatAt: string | null;
    windowStart: string;
    taskCount: number;
    sampledCount: number;
    taskSignals: RebuildTaskSignal[];
    openIssueCount: number;
  };
}
