import { authorize, type AccessContext, type Action } from './rbac';

/**
 * Controlled AI tool gateway (board 04 / 08 / E). The language model may only *propose*
 * a tool call as JSON {tool_name, args, evidence_refs, expected_version}. The gateway:
 *  - loads identity & scope from the server session (never from the prompt),
 *  - validates arguments against the tool schema,
 *  - checks role permission and entity scope on the server,
 *  - executes read tools directly, but turns write tools into proposals that need an
 *    approver bound to the current data version,
 *  - logs every call (user, tool, time, inputs, outputs, versions).
 */
export type JsonType = 'string' | 'number' | 'boolean';

export interface ToolParam {
  type: JsonType;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  kind: 'read' | 'write';
  permission: Action;
  params: Record<string, ToolParam>;
}

export interface ToolCallProposal {
  toolName: string;
  args: Record<string, unknown>;
  evidenceRefs?: string[];
  expectedVersion?: number;
}

export type GatewayOutcome =
  | { status: 'executed'; result: unknown }
  | { status: 'needs_approval'; proposal: ToolCallProposal; impact: string }
  | { status: 'rejected'; reason: string };

export interface ToolAuditEntry {
  at: string;
  userId: string;
  tenantId: string;
  tool: string;
  args: Record<string, unknown>;
  outcome: GatewayOutcome['status'];
  detail: string;
}

export function validateArgs(def: ToolDefinition, args: Record<string, unknown>): string | null {
  for (const [key, p] of Object.entries(def.params)) {
    const v = args[key];
    if (v === undefined || v === null || v === '') {
      if (p.required) return `Thiếu tham số bắt buộc "${key}"`;
      continue;
    }
    if (typeof v !== p.type) return `Tham số "${key}" phải có kiểu ${p.type}`;
    if (p.enum && !p.enum.includes(String(v))) return `Tham số "${key}" không thuộc danh sách cho phép`;
  }
  for (const key of Object.keys(args)) {
    if (!(key in def.params)) return `Tham số "${key}" không được khai báo`;
  }
  return null;
}

export class ToolGateway {
  private readonly defs = new Map<string, ToolDefinition>();
  private readonly impls = new Map<
    string,
    (args: Record<string, unknown>, ctx: AccessContext) => Promise<unknown>
  >();
  readonly audit: ToolAuditEntry[] = [];

  register(
    def: ToolDefinition,
    impl: (args: Record<string, unknown>, ctx: AccessContext) => Promise<unknown>,
  ): void {
    this.defs.set(def.name, def);
    this.impls.set(def.name, impl);
  }

  definitions(): ToolDefinition[] {
    return [...this.defs.values()];
  }

  /** Tools visible to a user: only those their roles allow. */
  definitionsFor(ctx: AccessContext): ToolDefinition[] {
    return this.definitions().filter((d) => authorize(ctx, { action: d.permission }).allowed);
  }

  async handle(
    call: ToolCallProposal,
    ctx: AccessContext,
    now = new Date().toISOString(),
  ): Promise<GatewayOutcome> {
    const def = this.defs.get(call.toolName);
    const log = (outcome: GatewayOutcome, detail: string) => {
      this.audit.push({
        at: now,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        tool: call.toolName,
        args: call.args,
        outcome: outcome.status,
        detail,
      });
      return outcome;
    };
    if (!def) return log({ status: 'rejected', reason: 'Công cụ không tồn tại' }, 'unknown tool');
    const invalid = validateArgs(def, call.args);
    if (invalid) return log({ status: 'rejected', reason: invalid }, 'schema');
    const auth = authorize(ctx, { action: def.permission });
    if (!auth.allowed) return log({ status: 'rejected', reason: auth.reason }, 'permission');
    if (def.kind === 'write') {
      return log(
        {
          status: 'needs_approval',
          proposal: call,
          impact: `Thực hiện "${def.description}" cần người có quyền phê duyệt theo phiên bản dữ liệu hiện tại.`,
        },
        'proposal',
      );
    }
    const impl = this.impls.get(def.name)!;
    try {
      const result = await impl(call.args, ctx);
      return log({ status: 'executed', result }, 'ok');
    } catch (e) {
      return log({ status: 'rejected', reason: e instanceof Error ? e.message : 'Lỗi công cụ' }, 'error');
    }
  }
}
