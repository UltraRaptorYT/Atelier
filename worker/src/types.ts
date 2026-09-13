export type Secrets = { CLERK_SECRET_KEY?: string; CLERK_JWT_KEY?: string; E2B_API_KEY?: string; KEY_ENCRYPTION_KEYS?: string };
export type Bindings = { [K in keyof Env]: Env[K] extends string ? string : Env[K] } & Secrets;
export type RunParams = { projectId: string; userId: string; runId: string; kind: 'generate' | 'change' | 'render'; baseRevision: number; instruction?: string; agent?: import('../../shared/design').AgentId; elementId?: string | null };
export type ProjectRow = { id: string; owner_id: string; name: string; brief: string; revision: number; design_key: string | null; status: string; created_at: string; updated_at: string };
export type RunRow = { id: string; project_id: string; owner_id: string; kind: string; status: string; base_revision: number; instruction: string | null };
