/**
 * Try-out builds on a device (Expo preview / development) are passed from one person to the next:
 * signing out puts the sample data back to its initial state.
 */
import { describe, expect, it } from 'vitest';
import { createLocalBackend } from '@argolet/client/local';

const DEMO = { contact: 'ketoan@minhan.example', password: 'Argolet@2026' };

async function device(freshAfterSignOut: boolean) {
  let token: string | null = null;
  const backend = await createLocalBackend({
    clockStart: Date.now(),
    tokens: { get: async () => token, set: async (t) => void (token = t) },
    label: 'test',
    userAgent: 'vitest',
    freshAfterSignOut,
  });
  const signIn = async () => {
    await backend.call('auth.login', { ...DEMO, remember: true });
    const ws = await backend.call('org.listWorkspaces');
    await backend.call('org.selectWorkspace', {
      tenantId: ws.find((w) => w.name === 'Minh An Commerce')!.tenantId,
    });
  };
  const csv = 'Ngày,Số tiền,Mã tham chiếu,Nội dung\n2026-10-30,1500000,GD-TEST-1,Thử nghiệm';
  const addDocument = () =>
    backend.call('documents.intake', { files: [{ name: 'sao-ke-thu.csv', text: csv }] });
  const total = async () => (await backend.call('documents.list', {})).total;
  return { backend, signIn, addDocument, total };
}

describe('try-out data on a device', () => {
  it('signing out restores the initial sample data for the next person', async () => {
    const d = await device(true);
    expect(d.backend.info.demo?.freshAfterSignOut).toBe(true);
    await d.signIn();
    const initial = await d.total();
    await d.addDocument();
    expect(await d.total()).toBe(initial + 1);
    await d.backend.call('auth.logout');
    await d.signIn();
    expect(await d.total()).toBe(initial);
  });

  it('without the option, the data stays as the person left it', async () => {
    const d = await device(false);
    await d.signIn();
    const initial = await d.total();
    await d.addDocument();
    await d.backend.call('auth.logout');
    await d.signIn();
    expect(await d.total()).toBe(initial + 1);
  });
});
