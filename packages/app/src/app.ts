import type { ExtractionProvider } from '@argolet/core';
import { AppCore } from './core';
import { DEFAULT_CONFIG, type AppConfig, type AppDeps, type LlmClient, type Notifier, type PasswordHasher } from './runtime';
import type { Store } from './store';
import { AuthService } from './services/auth';
import { OrgService } from './services/org';
import { DocumentService } from './services/documents';
import { ReconService } from './services/recon';
import { ApprovalService } from './services/approvals';
import { CloseService } from './services/close';
import { EvidenceService } from './services/evidence';
import { DashboardService } from './services/dashboard';
import { FinanceService } from './services/finance';
import { ModuleService } from './services/modules';
import { AssistantService } from './services/assistant';
import { onMatchResolvedValidateDocuments } from './services/consumers';
import { FilenameHintExtractionProvider } from './extraction';
import { ScryptHasher } from './hashers';

export interface ArgoletAppOptions {
  store: Store;
  hasher?: PasswordHasher;
  notifier?: Notifier;
  extraction?: ExtractionProvider;
  llm?: LlmClient | null;
  clock?: () => Date;
  config?: Partial<AppConfig>;
}

export type ArgoletApp = ReturnType<typeof createArgoletApp>;

export function createArgoletApp(opts: ArgoletAppOptions) {
  const deps: AppDeps = {
    store: opts.store,
    hasher: opts.hasher ?? new ScryptHasher(),
    notifier: opts.notifier ?? { sendCode: async () => undefined },
    extraction: opts.extraction ?? new FilenameHintExtractionProvider(),
    llm: opts.llm ?? null,
    clock: opts.clock ?? (() => new Date()),
    config: { ...DEFAULT_CONFIG, ...opts.config },
  };
  const core = new AppCore(deps);
  const auth = new AuthService(core);
  const org = new OrgService(core);
  const documents = new DocumentService(core);
  const recon = new ReconService(core);
  const approvals = new ApprovalService(core, recon);
  const close = new CloseService(core);
  const evidence = new EvidenceService(core);
  const dashboard = new DashboardService(core);
  const finance = new FinanceService(core);
  const modules = new ModuleService(core);
  const assistant = new AssistantService(core);

  // Event consumers (idempotent via inbox, processed in outbox commit order).
  core.relay.on('DocumentValidated', 'evidence-documents', (e, tx, em) => evidence.onDocumentValidated(e, tx, em));
  core.relay.on('PeriodClosed', 'evidence-close', (e, tx, em) => evidence.onPeriodClosed(e, tx, em));
  core.relay.on('MatchResolved', 'documents-after-recon', (e, tx, em) => onMatchResolvedValidateDocuments(e, tx, em));
  core.relay.on('*', 'projection-dashboard', (e, tx) => dashboard.onEvent(e, tx));
  core.relay.on('*', 'notifications', (e, tx, em) => dashboard.onNotify(e, tx, em));

  return { core, deps, auth, org, documents, recon, approvals, close, evidence, dashboard, finance, modules, assistant };
}
