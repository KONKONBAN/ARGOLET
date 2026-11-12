import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Building2, ChartColumn, ChevronDown, CircleHelp, Files, FolderKanban, GitCompareArrows, Grid2x2, Inbox, LayoutGrid, LogOut, Menu, Search,
  Settings, ShieldCheck, SlidersHorizontal, Sparkles, Store, Ellipsis, ArrowLeftRight, X,
} from 'lucide-react';
import logo from '../assets/logo.jpg';
import hero from '../assets/hero.jpg';
import banner from '../assets/banner.jpg';
import { useBackend, useMutation, useQuery } from '../api/hooks';
import { Avatar, useToast } from '../ui/components';
import { useSession } from './session';

// ───────── 01–08 · auth layout: illustration left, form right ─────────
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-art" style={{ backgroundImage: `url(${hero})` }} aria-hidden>
        <div className="auth-art-logo">
          <img src={logo} alt="" />
        </div>
      </div>
      <main className="auth-main">
        <div className="auth-mobile-banner" style={{ backgroundImage: `url(${banner})` }}>
          <div className="logo">
            <img src={logo} alt="ARGOLET" />
          </div>
        </div>
        <div className="auth-form">{children}</div>
        <footer className="auth-foot">
          <span>Tiếng Việt</span>
          <a href="mailto:hotro@argolet.vn">Trợ giúp</a>
        </footer>
      </main>
    </div>
  );
}

// ───────── app shell (screens 09–40) ─────────
const NAV_MAIN = [
  { to: '/overview', label: 'Tổng quan', icon: LayoutGrid },
  { to: '/inbox', label: 'Hộp công việc', icon: Inbox, badge: true },
  { to: '/documents', label: 'Chứng từ', icon: Files },
  { to: '/reconciliation', label: 'Đối soát', icon: GitCompareArrows },
];
const NAV_MODULES = [
  { to: '/daily-close', label: 'Vận hành', icon: Store, match: ['/daily-close', '/inventory', '/purchasing', '/books'] },
  { to: '/projects', label: 'Dự án', icon: FolderKanban, match: ['/projects', '/assets', '/logistics', '/logistics-finance'] },
  { to: '/finance', label: 'Phân tích tài chính', icon: ChartColumn, match: ['/finance', '/scenarios'] },
  { to: '/modules', label: 'Tất cả phân hệ', icon: Grid2x2, match: ['/modules', '/clients', '/sales', '/group', '/intercompany'] },
];

export function AppShell() {
  const { ctx, me, signOut } = useSession();
  const { backend } = useBackend();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const select = useMutation('org.selectWorkspace');
  const { refresh } = useSession();
  useEffect(() => setOpen(false), [location.pathname]);
  if (!ctx || !me) return null;
  const sites = ctx.entities.filter((e) => e.kind === 'SITE');
  const isActive = (paths?: string[]) => !!paths?.some((p) => location.pathname === p || location.pathname.startsWith(p + '/'));
  const legal = ctx.entities.find((e) => e.kind === 'LEGAL_ENTITY' && sites.some((s) => s.parentId === e.id));
  const changeScope = async (entityId: string) => {
    await select.mutate({ tenantId: ctx.tenant.id, entityId });
    await refresh();
    toast('success', entityId === '*' ? 'Đang xem tất cả cơ sở' : `Đang xem ${sites.find((s) => s.id === entityId)?.name ?? ''}`);
  };
  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Điều hướng chính">
        <div className="side-logo">
          <img src={logo} alt="ARGOLET" />
        </div>
        <button className="ws-card" onClick={() => navigate('/workspaces')} title="Đổi không gian làm việc">
          <Building2 size={22} color="#b1ebd2" aria-hidden />
          <span style={{ minWidth: 0 }}>
            <div className="t">{legal?.shortName ?? ctx.tenant.name}</div>
            <div className="s">{sites.length ? `${sites.length} cơ sở` : `${ctx.entities.length} pháp nhân`}</div>
          </span>
          <ChevronDown size={16} color="#c7d9e2" aria-hidden />
        </button>
        <div className="nav-label">Không gian làm việc</div>
        <nav className="nav">
          {NAV_MAIN.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive: a }) => (a || isActive([n.to]) ? 'active' : '')}>
              <n.icon size={20} aria-hidden />
              <span>{n.label}</span>
              {n.badge && ctx.counts.inbox > 0 ? <span className="badge">{ctx.counts.inbox}</span> : <span />}
            </NavLink>
          ))}
        </nav>
        <div className="nav-sep" />
        <div className="nav-label">Phân hệ</div>
        <nav className="nav">
          {NAV_MODULES.map((n) => (
            <NavLink key={n.to} to={n.to} className={() => (isActive(n.match) ? 'active' : '')}>
              <n.icon size={20} aria-hidden />
              <span>{n.label}</span>
              <span />
            </NavLink>
          ))}
        </nav>
        <nav className="nav" style={{ marginTop: 26 }}>
          <NavLink to="/assistant" className={({ isActive: a }) => (a ? 'active' : '')}>
            <Sparkles size={20} aria-hidden />
            <span>Trợ lý ARGOLET</span>
            <span />
          </NavLink>
        </nav>
        <div className="nav-sep" />
        <nav className="nav" style={{ marginBottom: 24 }}>
          <NavLink to="/settings" className={() => (isActive(['/settings', '/members', '/notifications', '/security']) ? 'active' : '')}>
            <SlidersHorizontal size={20} aria-hidden />
            <span>Cài đặt</span>
            <span />
          </NavLink>
        </nav>
        <div style={{ position: 'relative', marginTop: 'auto' }}>
          <button className="side-user" onClick={() => setUserMenu((s) => !s)} aria-haspopup="menu" aria-expanded={userMenu}>
            <Avatar name={ctx.member.displayName} />
            <span style={{ minWidth: 0 }}>
              <div className="n">{ctx.member.displayName}</div>
              <div className="r">{ctx.member.title}</div>
            </span>
          </button>
          {userMenu && (
            <div className="dropdown" role="menu" style={{ bottom: 'calc(100% + 6px)', top: 'auto', left: 0, right: 0 }}>
              <button role="menuitem" onClick={() => navigate('/security')}>
                <ShieldCheck size={16} /> Bảo mật tài khoản
              </button>
              <button role="menuitem" onClick={() => navigate('/workspaces')}>
                <ArrowLeftRight size={16} /> Đổi không gian làm việc
              </button>
              {backend.info.mode === 'browser' && (
                <button
                  role="menuitem"
                  onClick={async () => {
                    if (!confirm('Khôi phục dữ liệu mẫu ban đầu? Mọi thay đổi trên trình duyệt này sẽ bị xóa.')) return;
                    await backend.reset?.();
                    window.location.reload();
                  }}
                >
                  <Settings size={16} /> Khôi phục dữ liệu mẫu
                </button>
              )}
              <button role="menuitem" onClick={() => void signOut()}>
                <LogOut size={16} /> Đăng xuất
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="main">
        {backend.info.mode === 'browser' && (
          <div className="demo-banner" role="note">
            <Sparkles size={14} /> Bản trải nghiệm chạy trên trình duyệt · dữ liệu mẫu Minh An Commerce · thời điểm mô phỏng 31/10/2026
          </div>
        )}
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Mở menu">
            <Menu size={22} />
          </button>
          <div className="crumb">
            <button className="org" onClick={() => navigate('/workspaces')}>
              {ctx.tenant.name} <ChevronDown size={14} color="#536978" aria-hidden />
            </button>
            {sites.length > 0 && (
              <>
                <span className="slash" aria-hidden>
                  /
                </span>
                <label className="sr-only" htmlFor="scope">
                  Phạm vi cơ sở
                </label>
                <select id="scope" value={ctx.scope.entityId} onChange={(e) => void changeScope(e.target.value)} disabled={select.loading}>
                  <option value="*">Tất cả cơ sở</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <GlobalSearch />
          <a className="icon-btn" href="mailto:hotro@argolet.vn" aria-label="Trợ giúp">
            <CircleHelp size={20} />
          </a>
          <NavLink to="/notifications" className="icon-btn" aria-label={`Thông báo (${ctx.counts.unreadNotifications} chưa đọc)`}>
            <Bell size={20} />
            {ctx.counts.unreadNotifications > 0 && <span className="dot-badge" />}
          </NavLink>
          <button className="icon-btn" onClick={() => navigate('/security')} aria-label="Tài khoản">
            <Avatar name={ctx.member.displayName} />
          </button>
        </header>
        <main id="content">
          <Outlet />
        </main>
        <nav className="bottom-nav" aria-label="Điều hướng nhanh">
          <NavLink to="/overview">
            <span className="ic">
              <LayoutGrid size={20} />
            </span>
            Tổng quan
          </NavLink>
          <NavLink to="/inbox">
            <span className="ic">
              <Inbox size={20} />
            </span>
            Công việc
          </NavLink>
          <NavLink to="/documents">
            <span className="ic">
              <Files size={20} />
            </span>
            Chứng từ
          </NavLink>
          <button onClick={() => setOpen(true)}>
            <span className="ic">
              <Ellipsis size={20} />
            </span>
            Thêm
          </button>
        </nav>
      </div>
    </div>
  );
}

/** Topbar search across documents and reconciliation groups. */
function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const docs = useQuery('documents.list', { q, limit: 6 }, { enabled: q.trim().length >= 2 });
  const groups = useQuery('recon.summary', { q }, { enabled: q.trim().length >= 2 });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const go = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };
  return (
    <div className="top-search" ref={box} style={{ position: 'relative' }}>
      <label className="search" style={{ height: 40 }}>
        <Search size={18} aria-hidden />
        <span className="sr-only">Tìm kiếm trong không gian</span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Tìm kiếm trong không gian..."
          type="search"
        />
        {q && (
          <button className="link-btn" onClick={() => setQ('')} aria-label="Xóa tìm kiếm">
            <X size={14} />
          </button>
        )}
      </label>
      {open && q.trim().length >= 2 && (
        <div className="search-results" role="listbox">
          {(docs.data?.items ?? []).map((d) => (
            <button key={d.id} className="conv-item" onClick={() => go(d.status === 'VALIDATED' ? `/evidence/${d.id}` : `/documents/${d.id}/review`)}>
              <Files size={14} style={{ verticalAlign: -2, marginRight: 8 }} /> {d.label} · {d.amountLabel}
            </button>
          ))}
          {(groups.data?.items ?? []).slice(0, 5).map((g) => (
            <button key={g.id} className="conv-item" onClick={() => go(`/reconciliation/${g.id}`)}>
              <GitCompareArrows size={14} style={{ verticalAlign: -2, marginRight: 8 }} /> {g.label} · {g.statusLabel}
            </button>
          ))}
          {docs.data && groups.data && docs.data.items.length === 0 && groups.data.items.length === 0 && <div className="empty">Không tìm thấy kết quả</div>}
          {(docs.loading || groups.loading) && <div className="empty">Đang tìm…</div>}
        </div>
      )}
    </div>
  );
}
