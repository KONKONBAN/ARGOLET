import type { ArgoletApp } from './app';
import type { CallContext } from './runtime';

/**
 * Single API contract shared by every transport:
 *  - the Fastify server registers one REST route per operation,
 *  - the web / mobile HTTP client builds requests from the same table,
 *  - the in-browser demo backend calls the handlers directly.
 * Path parameters (":name") are taken from the params object.
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface OperationDef<P, R> {
  method: HttpMethod;
  path: string;
  /** Public operations do not require a session. */
  public?: boolean;
  /** Issues / clears the session cookie. */
  session?: 'issue' | 'clear';
  handler: (app: ArgoletApp, call: CallContext, params: P) => Promise<R>;
}

function op<P, R>(
  method: HttpMethod,
  path: string,
  handler: (app: ArgoletApp, call: CallContext, params: P) => Promise<R>,
  extra: Partial<Pick<OperationDef<P, R>, 'public' | 'session'>> = {},
): OperationDef<P, R> {
  return { method, path, handler, ...extra };
}

type ParamsOf<F> = F extends (call: CallContext, p: infer P) => unknown
  ? P
  : F extends (call: CallContext) => unknown
    ? Record<string, never>
    : never;
type Svc = ArgoletApp;

export const operations = {
  // 01–02 · Tài khoản và phiên
  'auth.register': op(
    'POST',
    '/v1/auth/register',
    (a, c, p: ParamsOf<Svc['auth']['register']>) => a.auth.register(c, p),
    { public: true },
  ),
  'auth.resendCode': op(
    'POST',
    '/v1/auth/resend-code',
    (a, c, p: ParamsOf<Svc['auth']['resendCode']>) => a.auth.resendCode(c, p),
    { public: true },
  ),
  'auth.verifyContact': op(
    'POST',
    '/v1/auth/verify',
    (a, c, p: ParamsOf<Svc['auth']['verifyContact']>) => a.auth.verifyContact(c, p),
    { public: true, session: 'issue' },
  ),
  'auth.login': op(
    'POST',
    '/v1/auth/login',
    (a, c, p: ParamsOf<Svc['auth']['login']>) => a.auth.login(c, p),
    { public: true, session: 'issue' },
  ),
  'auth.logout': op('POST', '/v1/auth/logout', (a, c) => a.auth.logout(c), {
    public: true,
    session: 'clear',
  }),
  'auth.me': op('GET', '/v1/auth/me', (a, c) => a.auth.me(c), { public: true }),
  'auth.requestPasswordReset': op(
    'POST',
    '/v1/auth/password-reset',
    (a, c, p: ParamsOf<Svc['auth']['requestPasswordReset']>) => a.auth.requestPasswordReset(c, p),
    { public: true },
  ),
  'auth.resetPassword': op(
    'POST',
    '/v1/auth/password-reset/confirm',
    (a, c, p: ParamsOf<Svc['auth']['resetPassword']>) => a.auth.resetPassword(c, p),
    { public: true },
  ),
  'auth.changePassword': op('POST', '/v1/auth/password', (a, c, p: ParamsOf<Svc['auth']['changePassword']>) =>
    a.auth.changePassword(c, p),
  ),
  'auth.listSessions': op('GET', '/v1/auth/sessions', (a, c) => a.auth.listSessions(c)),
  'auth.revokeSession': op(
    'DELETE',
    '/v1/auth/sessions/:sessionId',
    (a, c, p: ParamsOf<Svc['auth']['revokeSession']>) => a.auth.revokeSession(c, p),
  ),
  'auth.setupTotp': op('POST', '/v1/auth/mfa/totp/setup', (a, c) => a.auth.setupTotp(c)),
  'auth.enableTotp': op('POST', '/v1/auth/mfa/totp/enable', (a, c, p: ParamsOf<Svc['auth']['enableTotp']>) =>
    a.auth.enableTotp(c, p),
  ),
  'auth.disableTotp': op(
    'POST',
    '/v1/auth/mfa/totp/disable',
    (a, c, p: ParamsOf<Svc['auth']['disableTotp']>) => a.auth.disableTotp(c, p),
  ),
  'auth.startStepUp': op('POST', '/v1/auth/step-up', (a, c) => a.auth.startStepUp(c)),
  'auth.completeStepUp': op(
    'POST',
    '/v1/auth/step-up/confirm',
    (a, c, p: ParamsOf<Svc['auth']['completeStepUp']>) => a.auth.completeStepUp(c, p),
  ),

  // 03–04 · Tổ chức, pháp nhân, phân quyền, thiết lập
  'org.listWorkspaces': op('GET', '/v1/workspaces', (a, c) => a.org.listWorkspaces(c)),
  'org.selectWorkspace': op(
    'POST',
    '/v1/workspaces/select',
    (a, c, p: ParamsOf<Svc['org']['selectWorkspace']>) => a.org.selectWorkspace(c, p),
  ),
  'org.context': op('GET', '/v1/workspace', (a, c) => a.org.context(c)),
  'org.createOrganization': op(
    'POST',
    '/v1/organizations',
    (a, c, p: ParamsOf<Svc['org']['createOrganization']>) => a.org.createOrganization(c, p),
  ),
  'org.getInvitation': op('GET', '/v1/invitations/:code', (a, c, p: ParamsOf<Svc['org']['getInvitation']>) =>
    a.org.getInvitation(c, p),
  ),
  'org.respondInvitation': op(
    'POST',
    '/v1/invitations/:code/respond',
    (a, c, p: ParamsOf<Svc['org']['respondInvitation']>) => a.org.respondInvitation(c, p),
  ),
  'org.listMembers': op('GET', '/v1/members', (a, c) => a.org.listMembers(c)),
  'org.inviteMember': op('POST', '/v1/members/invitations', (a, c, p: ParamsOf<Svc['org']['inviteMember']>) =>
    a.org.inviteMember(c, p),
  ),
  'org.updateMember': op(
    'PATCH',
    '/v1/members/:membershipId',
    (a, c, p: ParamsOf<Svc['org']['updateMember']>) => a.org.updateMember(c, p),
  ),
  'org.settings': op('GET', '/v1/settings', (a, c) => a.org.settings(c)),
  'org.updateSettings': op('PATCH', '/v1/settings', (a, c, p: ParamsOf<Svc['org']['updateSettings']>) =>
    a.org.updateSettings(c, p),
  ),
  'org.connectAi': op('POST', '/v1/settings/ai/connect', (a, c, p: ParamsOf<Svc['org']['connectAi']>) =>
    a.org.connectAi(c, p),
  ),
  'org.disconnectAi': op(
    'POST',
    '/v1/settings/ai/disconnect',
    (a, c, p: ParamsOf<Svc['org']['disconnectAi']>) => a.org.disconnectAi(c, p),
  ),
  'org.addEntity': op('POST', '/v1/entities', (a, c, p: ParamsOf<Svc['org']['addEntity']>) =>
    a.org.addEntity(c, p),
  ),
  'org.setIntegration': op(
    'POST',
    '/v1/integrations/:integrationId',
    (a, c, p: ParamsOf<Svc['org']['setIntegration']>) => a.org.setIntegration(c, p),
  ),
  // Kết nối API đối tác (ARGOLET gọi sang SePay, KiotViet…)
  'connections.list': op('GET', '/v1/connections', (a, c) => a.connections.list(c)),
  'connections.connect': op('POST', '/v1/connections', (a, c, p: ParamsOf<Svc['connections']['connect']>) =>
    a.connections.connect(c, p),
  ),
  'connections.test': op(
    'POST',
    '/v1/connections/:connectionId/test',
    (a, c, p: ParamsOf<Svc['connections']['test']>) => a.connections.test(c, p),
  ),
  'connections.sync': op(
    'POST',
    '/v1/connections/:connectionId/sync',
    (a, c, p: ParamsOf<Svc['connections']['sync']>) => a.connections.sync(c, p),
  ),
  'connections.disconnect': op(
    'DELETE',
    '/v1/connections/:connectionId',
    (a, c, p: ParamsOf<Svc['connections']['disconnect']>) => a.connections.disconnect(c, p),
  ),

  // 05 · Tiếp nhận và chuẩn hóa chứng từ
  'documents.intake': op('POST', '/v1/import-batches', (a, c, p: ParamsOf<Svc['documents']['intake']>) =>
    a.documents.intake(c, p),
  ),
  'documents.listBatches': op('GET', '/v1/import-batches', (a, c) => a.documents.listBatches(c)),
  'documents.list': op('GET', '/v1/documents', (a, c, p: ParamsOf<Svc['documents']['listDocuments']>) =>
    a.documents.listDocuments(c, p),
  ),
  'documents.get': op(
    'GET',
    '/v1/documents/:documentId',
    (a, c, p: ParamsOf<Svc['documents']['getDocument']>) => a.documents.getDocument(c, p),
  ),
  'documents.saveDraft': op(
    'POST',
    '/v1/documents/:documentId/draft',
    (a, c, p: ParamsOf<Svc['documents']['saveDraft']>) => a.documents.saveDraft(c, p),
  ),
  'documents.confirm': op(
    'POST',
    '/v1/documents/:documentId/confirm',
    (a, c, p: ParamsOf<Svc['documents']['confirmDocument']>) => a.documents.confirmDocument(c, p),
  ),
  'documents.reject': op(
    'POST',
    '/v1/documents/:documentId/reject',
    (a, c, p: ParamsOf<Svc['documents']['rejectDocument']>) => a.documents.rejectDocument(c, p),
  ),

  // 06 · Đối soát đa nguồn M:N
  'recon.summary': op('GET', '/v1/match-groups', (a, c, p: ParamsOf<Svc['recon']['summary']>) =>
    a.recon.summary(c, p),
  ),
  'recon.getGroup': op('GET', '/v1/match-groups/:groupId', (a, c, p: ParamsOf<Svc['recon']['getGroup']>) =>
    a.recon.getGroup(c, p),
  ),
  'recon.run': op('POST', '/v1/reconciliation-runs', (a, c, p: ParamsOf<Svc['recon']['run']>) =>
    a.recon.run(c, p),
  ),
  'recon.confirm': op(
    'POST',
    '/v1/match-groups/:groupId/confirm',
    (a, c, p: ParamsOf<Svc['recon']['confirm']>) => a.recon.confirm(c, p),
  ),
  'recon.submitForApproval': op(
    'POST',
    '/v1/match-groups/:groupId/submit',
    (a, c, p: ParamsOf<Svc['recon']['submitForApproval']>) => a.recon.submitForApproval(c, p),
  ),

  // 09 · Phê duyệt và chốt số liệu
  'approvals.inbox': op('GET', '/v1/inbox', (a, c, p: ParamsOf<Svc['approvals']['inbox']>) =>
    a.approvals.inbox(c, p),
  ),
  'approvals.list': op('GET', '/v1/approvals', (a, c) => a.approvals.list(c)),
  'approvals.get': op('GET', '/v1/approvals/:approvalId', (a, c, p: ParamsOf<Svc['approvals']['get']>) =>
    a.approvals.get(c, p),
  ),
  'approvals.decide': op(
    'POST',
    '/v1/approvals/:approvalId/decisions',
    (a, c, p: ParamsOf<Svc['approvals']['decide']>) => a.approvals.decide(c, p),
  ),
  'close.status': op('GET', '/v1/periods/current', (a, c, p: ParamsOf<Svc['close']['status']>) =>
    a.close.status(c, p),
  ),
  'close.close': op('POST', '/v1/periods/:periodId/close', (a, c, p: ParamsOf<Svc['close']['close']>) =>
    a.close.close(c, p),
  ),
  'close.decisionPack': op('GET', '/v1/decision-pack', (a, c, p: ParamsOf<Svc['close']['decisionPack']>) =>
    a.close.decisionPack(c, p),
  ),

  // 11 · Bằng chứng toàn vẹn và kiểm chứng
  'evidence.document': op(
    'GET',
    '/v1/evidence/documents/:documentId',
    (a, c, p: ParamsOf<Svc['evidence']['documentEvidence']>) => a.evidence.documentEvidence(c, p),
  ),
  'evidence.integrity': op(
    'GET',
    '/v1/evidence/documents/:documentId/integrity',
    (a, c, p: ParamsOf<Svc['evidence']['integrityInfo']>) => a.evidence.integrityInfo(c, p),
  ),
  'evidence.verifyDocument': op(
    'POST',
    '/v1/evidence/documents/:documentId/verify',
    (a, c, p: ParamsOf<Svc['evidence']['verifyDocument']>) => a.evidence.verifyDocument(c, p),
  ),
  'evidence.snapshots': op('GET', '/v1/snapshots', (a, c) => a.evidence.listSnapshots(c)),
  'evidence.snapshot': op('GET', '/v1/snapshots/:closeId', (a, c, p: ParamsOf<Svc['evidence']['snapshot']>) =>
    a.evidence.snapshot(c, p),
  ),
  'evidence.verifyClose': op(
    'GET',
    '/v1/evidence/:closeId/verify',
    (a, c, p: ParamsOf<Svc['evidence']['verifyClose']>) => a.evidence.verifyClose(c, p),
  ),

  // 10 / 12 · Dữ liệu đọc, báo cáo, thông báo
  'dashboard.overview': op('GET', '/v1/dashboard', (a, c) => a.dashboard.overview(c)),
  'dashboard.notifications': op(
    'GET',
    '/v1/notifications',
    (a, c, p: ParamsOf<Svc['dashboard']['notifications']>) => a.dashboard.notifications(c, p),
  ),
  'dashboard.markRead': op(
    'POST',
    '/v1/notifications/read',
    (a, c, p: ParamsOf<Svc['dashboard']['markNotificationsRead']>) => a.dashboard.markNotificationsRead(c, p),
  ),

  // 07 · Finance Engine
  'finance.report': op('GET', '/v1/finance/report', (a, c, p: ParamsOf<Svc['finance']['report']>) =>
    a.finance.report(c, p),
  ),
  'finance.exportReport': op(
    'POST',
    '/v1/finance/report/export',
    (a, c, p: ParamsOf<Svc['finance']['exportReport']>) => a.finance.exportReport(c, p),
  ),
  'ledger.overview': op('GET', '/v1/ledger', (a, c, p: ParamsOf<Svc['ledger']['overview']>) =>
    a.ledger.overview(c, p),
  ),
  'ledger.journal': op('GET', '/v1/ledger/journal', (a, c, p: ParamsOf<Svc['ledger']['journal']>) =>
    a.ledger.journal(c, p),
  ),
  'ledger.saveSettings': op(
    'POST',
    '/v1/ledger/settings',
    (a, c, p: ParamsOf<Svc['ledger']['saveSettings']>) => a.ledger.saveSettings(c, p),
  ),
  'ledger.export': op('POST', '/v1/ledger/export', (a, c, p: ParamsOf<Svc['ledger']['exportBooks']>) =>
    a.ledger.exportBooks(c, p),
  ),
  'finance.appraisal': op('GET', '/v1/finance/appraisal', (a, c, p: ParamsOf<Svc['finance']['appraisal']>) =>
    a.finance.appraisal(c, p),
  ),
  'finance.createProject': op(
    'POST',
    '/v1/finance/projects',
    (a, c, p: ParamsOf<Svc['finance']['createProject']>) => a.finance.createProject(c, p),
  ),
  'finance.recalculate': op(
    'POST',
    '/v1/finance/calc-runs',
    (a, c, p: ParamsOf<Svc['finance']['recalculate']>) => a.finance.recalculate(c, p),
  ),
  'finance.scenarios': op('GET', '/v1/finance/scenarios', (a, c, p: ParamsOf<Svc['finance']['scenarios']>) =>
    a.finance.scenarios(c, p),
  ),
  'finance.calcRuns': op('GET', '/v1/finance/calc-runs', (a, c) => a.finance.calcRuns(c)),

  // 04 · Phân hệ G1–G4
  'modules.dailyClose': op('GET', '/v1/g1/daily-close', (a, c, p: ParamsOf<Svc['modules']['dailyClose']>) =>
    a.modules.dailyClose(c, p),
  ),
  'modules.openShift': op('POST', '/v1/g1/daily-close', (a, c, p: ParamsOf<Svc['modules']['openShift']>) =>
    a.modules.openShift(c, p),
  ),
  'modules.submitDailyClose': op(
    'POST',
    '/v1/g1/daily-close/:shiftId/submit',
    (a, c, p: ParamsOf<Svc['modules']['submitDailyClose']>) => a.modules.submitDailyClose(c, p),
  ),
  'modules.inventory': op('GET', '/v1/g1/inventory', (a, c, p: ParamsOf<Svc['modules']['inventory']>) =>
    a.modules.inventory(c, p),
  ),
  'modules.addInventoryItem': op(
    'POST',
    '/v1/g1/inventory',
    (a, c, p: ParamsOf<Svc['modules']['addInventoryItem']>) => a.modules.addInventoryItem(c, p),
  ),
  'modules.saveRecipe': op('POST', '/v1/g1/recipes', (a, c, p: ParamsOf<Svc['modules']['saveRecipe']>) =>
    a.modules.saveRecipe(c, p),
  ),
  'modules.adjustStock': op(
    'POST',
    '/v1/g1/inventory/:itemId/count',
    (a, c, p: ParamsOf<Svc['modules']['adjustStock']>) => a.modules.adjustStock(c, p),
  ),
  'modules.purchasing': op('GET', '/v1/g1/purchase-orders', (a, c) => a.modules.purchasing(c)),
  'modules.createPurchaseOrder': op(
    'POST',
    '/v1/g1/purchase-orders',
    (a, c, p: ParamsOf<Svc['modules']['createPurchaseOrder']>) => a.modules.createPurchaseOrder(c, p),
  ),
  'modules.booksTax': op('GET', '/v1/g1/books', (a, c) => a.modules.booksTax(c)),
  'modules.exportBooks': op(
    'GET',
    '/v1/g1/books/export',
    (a, c, p: ParamsOf<Svc['modules']['exportBooks']>) => a.modules.exportBooks(c, p),
  ),
  'modules.clients': op('GET', '/v1/g2/clients', (a, c, p: ParamsOf<Svc['modules']['clients']>) =>
    a.modules.clients(c, p),
  ),
  'modules.addClient': op('POST', '/v1/g2/clients', (a, c, p: ParamsOf<Svc['modules']['addClient']>) =>
    a.modules.addClient(c, p),
  ),
  'modules.sales': op('GET', '/v1/g2/deals', (a, c, p: ParamsOf<Svc['modules']['sales']>) =>
    a.modules.sales(c, p),
  ),
  'modules.updateDealStage': op(
    'PATCH',
    '/v1/g2/deals/:dealId',
    (a, c, p: ParamsOf<Svc['modules']['updateDealStage']>) => a.modules.updateDealStage(c, p),
  ),
  'modules.createDeal': op('POST', '/v1/g2/deals', (a, c, p: ParamsOf<Svc['modules']['createDeal']>) =>
    a.modules.createDeal(c, p),
  ),
  'modules.projects': op('GET', '/v1/g3/projects', (a, c, p: ParamsOf<Svc['modules']['projects']>) =>
    a.modules.projects(c, p),
  ),
  'modules.createProject': op(
    'POST',
    '/v1/g3/projects',
    (a, c, p: ParamsOf<Svc['modules']['createProject']>) => a.modules.createProject(c, p),
  ),
  'modules.updateWbsTask': op(
    'PATCH',
    '/v1/g3/projects/:projectId/tasks/:code',
    (a, c, p: ParamsOf<Svc['modules']['updateWbsTask']>) => a.modules.updateWbsTask(c, p),
  ),
  'modules.recordProjectCost': op(
    'POST',
    '/v1/g3/projects/:projectId/costs',
    (a, c, p: ParamsOf<Svc['modules']['recordProjectCost']>) => a.modules.recordProjectCost(c, p),
  ),
  'modules.addWbsTask': op(
    'POST',
    '/v1/g3/projects/:projectId/tasks',
    (a, c, p: ParamsOf<Svc['modules']['addWbsTask']>) => a.modules.addWbsTask(c, p),
  ),
  'modules.assets': op('GET', '/v1/g3/assets', (a, c) => a.modules.assets(c)),
  'modules.addAsset': op('POST', '/v1/g3/assets', (a, c, p: ParamsOf<Svc['modules']['addAsset']>) =>
    a.modules.addAsset(c, p),
  ),
  'modules.completeMaintenance': op(
    'POST',
    '/v1/g3/assets/:assetId/maintenance',
    (a, c, p: ParamsOf<Svc['modules']['completeMaintenance']>) => a.modules.completeMaintenance(c, p),
  ),
  'modules.logistics': op(
    'GET',
    '/v1/g3/shipments/current',
    (a, c, p: ParamsOf<Svc['modules']['logistics']>) => a.modules.logistics(c, p),
  ),
  'modules.logisticsFinance': op(
    'GET',
    '/v1/g3/shipments/current/finance',
    (a, c, p: ParamsOf<Svc['modules']['logisticsFinance']>) => a.modules.logisticsFinance(c, p),
  ),
  'modules.createShipment': op(
    'POST',
    '/v1/g3/shipments',
    (a, c, p: ParamsOf<Svc['modules']['createShipment']>) => a.modules.createShipment(c, p),
  ),
  'modules.addShipmentEvent': op(
    'POST',
    '/v1/g3/shipments/:shipmentId/events',
    (a, c, p: ParamsOf<Svc['modules']['addShipmentEvent']>) => a.modules.addShipmentEvent(c, p),
  ),
  'modules.addShipmentCost': op(
    'POST',
    '/v1/g3/shipments/:shipmentId/costs',
    (a, c, p: ParamsOf<Svc['modules']['addShipmentCost']>) => a.modules.addShipmentCost(c, p),
  ),
  'modules.confirmAllocation': op(
    'POST',
    '/v1/g3/shipments/:shipmentId/allocation',
    (a, c, p: ParamsOf<Svc['modules']['confirmAllocation']>) => a.modules.confirmAllocation(c, p),
  ),
  'modules.group': op('GET', '/v1/g4/group', (a, c) => a.modules.group(c)),
  'modules.intercompany': op(
    'GET',
    '/v1/g4/intercompany',
    (a, c, p: ParamsOf<Svc['modules']['intercompany']>) => a.modules.intercompany(c, p),
  ),
  'modules.createIntercompanyPair': op(
    'POST',
    '/v1/g4/intercompany',
    (a, c, p: ParamsOf<Svc['modules']['createIntercompanyPair']>) => a.modules.createIntercompanyPair(c, p),
  ),
  'modules.updateIntercompanyAmounts': op(
    'PATCH',
    '/v1/g4/intercompany/:pairId',
    (a, c, p: ParamsOf<Svc['modules']['updateIntercompanyAmounts']>) =>
      a.modules.updateIntercompanyAmounts(c, p),
  ),
  'modules.requestIntercompanyDocs': op(
    'POST',
    '/v1/g4/intercompany/:pairId/request-docs',
    (a, c, p: ParamsOf<Svc['modules']['requestIntercompanyDocs']>) => a.modules.requestIntercompanyDocs(c, p),
  ),

  // 08 · AI có kiểm soát
  'assistant.conversations': op('GET', '/v1/assistant/conversations', (a, c) => a.assistant.conversations(c)),
  'assistant.conversation': op(
    'GET',
    '/v1/assistant/conversations/:conversationId',
    (a, c, p: ParamsOf<Svc['assistant']['conversation']>) => a.assistant.conversation(c, p),
  ),
  'assistant.ask': op('POST', '/v1/assistant/ask', (a, c, p: ParamsOf<Svc['assistant']['ask']>) =>
    a.assistant.ask(c, p),
  ),
  'assistant.submitProposal': op(
    'POST',
    '/v1/assistant/proposals',
    (a, c, p: ParamsOf<Svc['assistant']['submitProposal']>) => a.assistant.submitProposal(c, p),
  ),
  'assistant.feedback': op(
    'POST',
    '/v1/assistant/feedback',
    (a, c, p: ParamsOf<Svc['assistant']['feedback']>) => a.assistant.feedback(c, p),
  ),
  'knowledge.list': op('GET', '/v1/knowledge', (a, c) => a.knowledge.list(c)),
  'knowledge.save': op('POST', '/v1/knowledge', (a, c, p: ParamsOf<Svc['knowledge']['save']>) =>
    a.knowledge.save(c, p),
  ),
  'knowledge.review': op(
    'POST',
    '/v1/knowledge/:id/review',
    (a, c, p: ParamsOf<Svc['knowledge']['review']>) => a.knowledge.review(c, p),
  ),
  'knowledge.remove': op(
    'POST',
    '/v1/knowledge/:id/remove',
    (a, c, p: ParamsOf<Svc['knowledge']['remove']>) => a.knowledge.remove(c, p),
  ),
  'knowledge.import': op(
    'POST',
    '/v1/knowledge/import',
    (a, c, p: ParamsOf<Svc['knowledge']['importText']>) => a.knowledge.importText(c, p),
  ),
  'knowledge.saveLockedTopics': op(
    'POST',
    '/v1/settings/ai/locked',
    (a, c, p: ParamsOf<Svc['knowledge']['saveLockedTopics']>) => a.knowledge.saveLockedTopics(c, p),
  ),
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;
export type OpParams<K extends OperationName> = Parameters<Operations[K]['handler']>[2];
export type OpResult<K extends OperationName> = Awaited<ReturnType<Operations[K]['handler']>>;

/** Build a concrete path (fill ":param") and return the remaining params. */
export function buildPath(
  template: string,
  params: Record<string, unknown>,
): { path: string; rest: Record<string, unknown> } {
  const rest = { ...params };
  const path = template.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const v = rest[name];
    delete rest[name];
    if (v === undefined || v === null || v === '') throw new Error(`Thiếu tham số đường dẫn ${name}`);
    return encodeURIComponent(String(v));
  });
  return { path, rest };
}

/** Wire format for errors returned by every transport. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> | undefined };
}
