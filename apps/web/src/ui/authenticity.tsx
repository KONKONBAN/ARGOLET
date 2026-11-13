import {
  CircleCheck,
  CircleMinus,
  CircleX,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { AuthenticityResult, CheckStatus } from '@argolet/core';
import { Chip } from './components';

const ORDER: Record<CheckStatus, number> = { FAIL: 0, WARN: 1, PASS: 2, NA: 3 };
const TONE = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'success' } as const;

/**
 * "Kiểm tra chứng từ giả": what the system checked on this document, problems first. A signal is
 * not a verdict — the person confirming the document decides, and the confirm step asks them to
 * acknowledge any failed check (recorded in the audit log).
 */
export function AuthenticityPanel({ result }: { result: AuthenticityResult }) {
  const shown = result.checks
    .filter((c) => c.status !== 'NA')
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const skipped = result.checks.filter((c) => c.status === 'NA');
  return (
    <section className="auth-panel" aria-label="Kiểm tra chứng từ giả">
      <div className="auth-head">
        {result.level === 'LOW' ? (
          <ShieldCheck size={20} aria-hidden className="auth-ok" />
        ) : (
          <ShieldAlert
            size={20}
            aria-hidden
            className={result.level === 'HIGH' ? 'auth-fail' : 'auth-warn'}
          />
        )}
        <strong>Kiểm tra chứng từ giả</strong>
        <Chip tone={TONE[result.level]}>{result.levelLabel}</Chip>
      </div>
      <ul className="auth-list">
        {shown.map((c) => (
          <li key={c.code} className={c.status.toLowerCase()} data-check={c.code}>
            {c.status === 'PASS' ? (
              <CircleCheck size={16} aria-label="Đạt" />
            ) : c.status === 'WARN' ? (
              <TriangleAlert size={16} aria-label="Cần lưu ý" />
            ) : (
              <CircleX size={16} aria-label="Bất thường" />
            )}
            <span>
              <span className="strong">{c.label}</span>
              <span className="muted small"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {skipped.length > 0 && (
        <details className="auth-na small">
          <summary className="muted">{skipped.length} mục không áp dụng</summary>
          <ul className="auth-list">
            {skipped.map((c) => (
              <li key={c.code} className="na" data-check={c.code}>
                <CircleMinus size={16} aria-label="Không áp dụng" />
                <span className="muted">
                  {c.label} — {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.lookupUrl && (
        <p className="small auth-foot">
          Trạng thái hủy, thay thế, điều chỉnh của hóa đơn chỉ cơ quan thuế xác nhận được:{' '}
          <a href={result.lookupUrl} target="_blank" rel="noreferrer">
            tra cứu trên cổng hóa đơn điện tử <ExternalLink size={12} aria-hidden />
          </a>
        </p>
      )}
    </section>
  );
}
