import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider, PageLoading } from '../ui/components';
import { SessionProvider, useSession } from './session';
import { AppShell } from './layouts';
import {
  LoginPage,
  RegisterPage,
  VerifyPage,
  ResetPage,
  WorkspacesPage,
  CreateOrgPage,
  InvitePage,
  ConnectPage,
} from '../pages/auth';

const OverviewPage = lazy(() => import('../pages/overview').then((m) => ({ default: m.OverviewPage })));
const InboxPage = lazy(() => import('../pages/overview').then((m) => ({ default: m.InboxPage })));
const NotificationsPage = lazy(() =>
  import('../pages/overview').then((m) => ({ default: m.NotificationsPage })),
);
const DocumentsPage = lazy(() => import('../pages/documents').then((m) => ({ default: m.DocumentsPage })));
const CapturePage = lazy(() => import('../pages/documents').then((m) => ({ default: m.CapturePage })));
const ReviewPage = lazy(() => import('../pages/documents').then((m) => ({ default: m.ReviewPage })));
const IngestionPage = lazy(() => import('../pages/documents').then((m) => ({ default: m.IngestionPage })));
const ReconPage = lazy(() => import('../pages/recon').then((m) => ({ default: m.ReconPage })));
const ReconDetailPage = lazy(() => import('../pages/recon').then((m) => ({ default: m.ReconDetailPage })));
const MatchWorkspacePage = lazy(() =>
  import('../pages/recon').then((m) => ({ default: m.MatchWorkspacePage })),
);
const ApprovalPage = lazy(() => import('../pages/approvals').then((m) => ({ default: m.ApprovalPage })));
const ClosePage = lazy(() => import('../pages/approvals').then((m) => ({ default: m.ClosePage })));
const DecisionPackPage = lazy(() =>
  import('../pages/approvals').then((m) => ({ default: m.DecisionPackPage })),
);
const EvidencePage = lazy(() => import('../pages/evidence').then((m) => ({ default: m.EvidencePage })));
const EvidenceIndexPage = lazy(() =>
  import('../pages/evidence').then((m) => ({ default: m.EvidenceIndexPage })),
);
const VerificationPage = lazy(() =>
  import('../pages/evidence').then((m) => ({ default: m.VerificationPage })),
);
const AssistantPage = lazy(() => import('../pages/assistant').then((m) => ({ default: m.AssistantPage })));
const DailyClosePage = lazy(() => import('../pages/g1').then((m) => ({ default: m.DailyClosePage })));
const InventoryPage = lazy(() => import('../pages/g1').then((m) => ({ default: m.InventoryPage })));
const PurchasingPage = lazy(() => import('../pages/g1').then((m) => ({ default: m.PurchasingPage })));
const BooksPage = lazy(() => import('../pages/g1').then((m) => ({ default: m.BooksPage })));
const ClientsPage = lazy(() => import('../pages/g2').then((m) => ({ default: m.ClientsPage })));
const SalesPage = lazy(() => import('../pages/g2').then((m) => ({ default: m.SalesPage })));
const ProjectsPage = lazy(() => import('../pages/g3').then((m) => ({ default: m.ProjectsPage })));
const FinancePage = lazy(() => import('../pages/g3').then((m) => ({ default: m.FinancePage })));
const ScenariosPage = lazy(() => import('../pages/g3').then((m) => ({ default: m.ScenariosPage })));
const AssetsPage = lazy(() => import('../pages/g3').then((m) => ({ default: m.AssetsPage })));
const LogisticsPage = lazy(() => import('../pages/g3').then((m) => ({ default: m.LogisticsPage })));
const LogisticsFinancePage = lazy(() =>
  import('../pages/g3').then((m) => ({ default: m.LogisticsFinancePage })),
);
const GroupPage = lazy(() => import('../pages/g4').then((m) => ({ default: m.GroupPage })));
const IntercompanyPage = lazy(() => import('../pages/g4').then((m) => ({ default: m.IntercompanyPage })));
const MembersPage = lazy(() => import('../pages/admin').then((m) => ({ default: m.MembersPage })));
const SettingsPage = lazy(() => import('../pages/admin').then((m) => ({ default: m.SettingsPage })));
const SecurityPage = lazy(() => import('../pages/admin').then((m) => ({ default: m.SecurityPage })));
const ModulesPage = lazy(() => import('../pages/admin').then((m) => ({ default: m.ModulesPage })));
const ConnectionsPage = lazy(() =>
  import('../pages/connections').then((m) => ({ default: m.ConnectionsPage })),
);

function Gate({ need, children }: { need: 'anon' | 'auth' | 'workspace'; children: ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') return <PageLoading />;
  if (need === 'anon') {
    if (status === 'ready') return <Navigate to="/overview" replace />;
    if (status === 'no-workspace') return <Navigate to="/workspaces" replace />;
    return <>{children}</>;
  }
  if (status === 'anon') return <Navigate to="/login" replace />;
  if (need === 'workspace' && status === 'no-workspace') return <Navigate to="/workspaces" replace />;
  return <>{children}</>;
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

const appRoutes: [string, ReactNode][] = [
  ['overview', <OverviewPage />],
  ['inbox', <InboxPage />],
  ['notifications', <NotificationsPage />],
  ['documents', <DocumentsPage />],
  ['capture', <CapturePage />],
  ['documents/:id/review', <ReviewPage />],
  ['ingestion', <IngestionPage />],
  ['reconciliation', <ReconPage />],
  ['reconciliation/:id', <ReconDetailPage />],
  ['match/:id', <MatchWorkspacePage />],
  ['approvals/:id', <ApprovalPage />],
  ['close', <ClosePage />],
  ['decision-pack', <DecisionPackPage />],
  ['evidence', <EvidenceIndexPage />],
  ['evidence/:id', <EvidencePage />],
  ['verification/:id', <VerificationPage />],
  ['assistant', <AssistantPage />],
  ['daily-close', <DailyClosePage />],
  ['inventory', <InventoryPage />],
  ['purchasing', <PurchasingPage />],
  ['books', <BooksPage />],
  ['clients', <ClientsPage />],
  ['sales', <SalesPage />],
  ['projects', <ProjectsPage />],
  ['finance', <FinancePage />],
  ['scenarios', <ScenariosPage />],
  ['assets', <AssetsPage />],
  ['logistics', <LogisticsPage />],
  ['logistics-finance', <LogisticsFinancePage />],
  ['group', <GroupPage />],
  ['intercompany', <IntercompanyPage />],
  ['members', <MembersPage />],
  ['settings', <SettingsPage />],
  ['security', <SecurityPage />],
  ['modules', <ModulesPage />],
  ['connections', <ConnectionsPage />],
];

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <SessionProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <Gate need="anon">
                  <LoginPage />
                </Gate>
              }
            />
            <Route
              path="/register"
              element={
                <Gate need="anon">
                  <RegisterPage />
                </Gate>
              }
            />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/reset" element={<ResetPage />} />
            <Route
              path="/workspaces"
              element={
                <Gate need="auth">
                  <WorkspacesPage />
                </Gate>
              }
            />
            <Route
              path="/create-org"
              element={
                <Gate need="auth">
                  <CreateOrgPage />
                </Gate>
              }
            />
            <Route
              path="/invite"
              element={
                <Gate need="auth">
                  <InvitePage />
                </Gate>
              }
            />
            <Route
              path="/connect"
              element={
                <Gate need="workspace">
                  <ConnectPage />
                </Gate>
              }
            />
            <Route
              element={
                <Gate need="workspace">
                  <AppShell />
                </Gate>
              }
            >
              {appRoutes.map(([path, el]) => (
                <Route key={path} path={`/${path}`} element={<Lazy>{el}</Lazy>} />
              ))}
            </Route>
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </SessionProvider>
      </ToastProvider>
    </HashRouter>
  );
}
