/**
 * Web app integration tests: the real React app, router and pages running on the same
 * in-browser backend that powers the static deployment (all services + demo seed).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clearCache, type Backend } from '@argolet/client';
import { createLocalBackend } from '@argolet/client/local';
import { BackendProvider } from '../src/api/hooks';
import { App } from '../src/app/App';

const DEMO = { contact: 'ketoan@minhan.example', password: 'Argolet@2026' };

async function newBackend(): Promise<Backend> {
  let token: string | null = null;
  return createLocalBackend({
    clockStart: Date.now(),
    tokens: { get: async () => token, set: async (t) => void (token = t) },
    label: 'test',
    userAgent: 'vitest',
  });
}

async function signIn(backend: Backend): Promise<void> {
  await backend.call('auth.login', { ...DEMO, remember: true });
  const ws = await backend.call('org.listWorkspaces');
  const minhAn = ws.find((w) => w.name === 'Minh An Commerce');
  if (!minhAn) throw new Error('demo workspace missing');
  await backend.call('org.selectWorkspace', { tenantId: minhAn.tenantId });
}

function renderAt(backend: Backend, hash: string) {
  window.location.hash = hash;
  return render(
    <BackendProvider backend={backend}>
      <App />
    </BackendProvider>,
  );
}

/** Waits until no skeleton/spinner is shown and returns the page heading. */
async function settled(): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(document.querySelector('h1')).not.toBeNull();
    },
    { timeout: 15000 },
  );
  return document.querySelector('h1') as HTMLElement;
}

const consoleErrors: string[] = [];
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' ').slice(0, 400));
  });
});
afterEach(() => {
  cleanup();
  clearCache();
  expect(consoleErrors).toEqual([]);
});

describe('authentication', () => {
  it('signs in with the demo account, picks a workspace and lands on the overview', async () => {
    const backend = await newBackend();
    renderAt(backend, '#/login');
    await screen.findByRole('heading', { name: 'Đăng nhập' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: DEMO.contact } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: DEMO.password } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await screen.findByRole('heading', { name: 'Chọn không gian làm việc' }, { timeout: 15000 });
    fireEvent.click(await screen.findByText('Minh An Commerce'));
    await screen.findByRole('heading', { name: 'Tổng quan kinh doanh' }, { timeout: 15000 });
    await settled();
    expect(document.body.textContent).toContain('+84.600.000 đ');
  });

  it('rejects a wrong password without leaving the login page', async () => {
    const backend = await newBackend();
    renderAt(backend, '#/login');
    await screen.findByRole('heading', { name: 'Đăng nhập' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: DEMO.contact } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'sai-mat-khau-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeTruthy();
  });

  it('redirects protected routes to the login page when signed out', async () => {
    const backend = await newBackend();
    renderAt(backend, '#/close');
    await screen.findByRole('heading', { name: 'Đăng nhập' });
    expect(window.location.hash).toBe('#/login');
  });
});

describe('every screen renders without errors', () => {
  let backend: Backend;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    backend = await newBackend();
    await signIn(backend);
    const docs = await backend.call('documents.list', { pageSize: 5 });
    ids.document = docs.items.find((d) => d.code === 'CT-1028')!.id;
    ids.validated = docs.items.find((d) => d.code === 'CT-1027')!.id;
    const recon = await backend.call('recon.summary', {});
    ids.group = recon.items[0]!.id;
    const approvals = await backend.call('approvals.list');
    ids.approval = approvals.find((a) => a.status === 'PENDING')!.id;
  });

  const routes: [string, string | RegExp][] = [
    ['overview', 'Tổng quan kinh doanh'],
    ['inbox', 'Việc cần xử lý'],
    ['notifications', 'Thông báo'],
    ['documents', 'Chứng từ'],
    ['capture', 'Tiếp nhận chứng từ'],
    ['ingestion', /Nhập dữ liệu/],
    ['reconciliation', 'Đối soát đa nguồn'],
    ['close', /Chốt kỳ/],
    ['decision-pack', /Decision Pack|hồ sơ quyết định/i],
    ['evidence', /Bằng chứng/],
    ['assistant', /Trợ lý/],
    ['daily-close', /Chốt ca/],
    ['inventory', /Kho/],
    ['purchasing', /Mua hàng/],
    ['books', /Sổ sách/],
    ['clients', /khách hàng/i],
    ['sales', /Bán hàng/],
    ['projects', /Dự án/],
    ['finance', /Phân tích tài chính|Thẩm định/],
    ['scenarios', /kịch bản/i],
    ['assets', /Tài sản/],
    ['logistics', /logistics/i],
    ['logistics-finance', /logistics/i],
    ['group', /tập đoàn/i],
    ['intercompany', /nội bộ/i],
    ['members', /Thành viên/],
    ['settings', /Cài đặt/],
    ['security', /Bảo mật/],
    ['modules', /Phân hệ|Mô-đun/i],
  ];

  it.each(routes)('/%s', async (route, title) => {
    renderAt(backend, `#/${route}`);
    const h1 = await settled();
    if (typeof title === 'string') expect(h1.textContent).toBe(title);
    else expect(h1.textContent).toMatch(title);
    expect(document.querySelector('.alert.danger')).toBeNull();
  });

  it.each([
    ['documents/:id/review', () => `documents/${ids.document}/review`],
    ['evidence/:id', () => `evidence/${ids.validated}`],
    ['verification/:id', () => `verification/${ids.validated}`],
    ['reconciliation/:id', () => `reconciliation/${ids.group}`],
    ['match/:id', () => `match/${ids.group}`],
    ['approvals/:id', () => `approvals/${ids.approval}`],
  ])('/%s', async (_name, path) => {
    renderAt(backend, `#/${path()}`);
    await settled();
    expect(document.querySelector('.alert.danger')).toBeNull();
  });

  it('unknown routes fall back to the overview', async () => {
    renderAt(backend, '#/khong-ton-tai');
    const h1 = await settled();
    expect(h1.textContent).toBe('Tổng quan kinh doanh');
  });
});

describe('core flows through the UI', () => {
  it('approves a pending request from the inbox', async () => {
    const backend = await newBackend();
    await signIn(backend);
    renderAt(backend, '#/inbox');
    await settled();
    fireEvent.click(screen.getAllByText('Duyệt chi mua nguyên liệu')[0]!);
    await screen.findByText('Luồng phê duyệt', undefined, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /Phê duyệt/ }));
    await screen.findByText('Đã phê duyệt hồ sơ', undefined, { timeout: 15000 });
    await waitFor(() => expect(window.location.hash).toBe('#/inbox'));
    const approvals = await backend.call('approvals.list');
    expect(approvals.find((a) => a.title === 'Duyệt chi mua nguyên liệu')?.status).toBe('APPROVED');
  });

  it('confirms a document that needs review and records evidence', async () => {
    const backend = await newBackend();
    await signIn(backend);
    const docs = await backend.call('documents.list', { pageSize: 5 });
    const doc = docs.items.find((d) => d.code === 'CT-1028')!;
    renderAt(backend, `#/documents/${doc.id}/review`);
    await settled();
    const confirm = () =>
      screen
        .getAllByRole('button')
        .find((b) => /Xác nhận/.test(b.textContent ?? '') && !(b as HTMLButtonElement).disabled);
    await act(async () => {
      fireEvent.click(confirm()!);
    });
    // A date warning must be acknowledged with a second confirmation.
    await waitFor(
      async () => {
        const after = await backend.call('documents.get', { documentId: doc.id });
        if (after.document.status !== 'VALIDATED') {
          const again = confirm();
          if (again) fireEvent.click(again);
        }
        expect(after.document.status).toBe('VALIDATED');
      },
      { timeout: 15000 },
    );
    const ev = await backend.call('evidence.document', { documentId: doc.id });
    expect(ev).toBeTruthy();
  });

  it('runs the assistant in rule mode and shows an answer', async () => {
    const backend = await newBackend();
    await signIn(backend);
    renderAt(backend, '#/assistant');
    await settled();
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Khoản nào chưa khớp?' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(document.body.textContent).toMatch(/nhóm chưa xác nhận/), { timeout: 15000 });
  });

  it('signs out from the account menu', async () => {
    const backend = await newBackend();
    await signIn(backend);
    renderAt(backend, '#/overview');
    await settled();
    const menu = document.querySelector<HTMLButtonElement>('button.side-user[aria-haspopup="menu"]')!;
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Đăng xuất/ }));
    await screen.findByRole('heading', { name: 'Đăng nhập' }, { timeout: 15000 });
    expect(await backend.call('auth.me')).toBeNull();
  });
});
