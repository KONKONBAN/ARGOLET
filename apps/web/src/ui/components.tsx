import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  FileX,
  Info,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { ApiError } from '../api/backend';

// ───────── buttons ─────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'danger' | 'ghost';
  loading?: boolean;
  block?: boolean;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
};
export function Button({
  variant = 'default',
  loading,
  block,
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: BtnProps) {
  const cls = [
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'danger' && 'btn-danger',
    variant === 'ghost' && 'btn-ghost',
    block && 'btn-block',
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={`spinner${variant === 'primary' ? '' : ' dark'}`} aria-hidden /> : icon}
      {children}
    </button>
  );
}

// ───────── form fields ─────────
function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="field-hint">{hint}</div>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
};
export function TextInput({ label, hint, error, id, className = '', ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <input
        id={fid}
        className={`input${error ? ' invalid' : ''} ${className}`}
        aria-invalid={!!error || undefined}
        {...rest}
      />
    </Field>
  );
}

export function SelectInput({
  label,
  value,
  onChange,
  options,
  id,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} htmlFor={fid}>
      <select
        id={fid}
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Amount in VND: digits only while typing, the formatted value as a hint underneath. */
/** "40000000" → "40.000.000" (Vietnamese grouping, no precision loss for very large amounts). */
export const groupDigits = (digits: string) =>
  digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Amount in đồng. The field shows the grouped figure as it is typed ("40.000.000 đ"), so no extra
 * line is needed to read it back; the value handed to the page is digits only. The caret stays after
 * the same digit while dots are inserted or removed.
 */
export function MoneyInput({
  label,
  value,
  onChange,
  error,
  id,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  id?: string;
  hint?: ReactNode;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = groupDigits(value.replace(/[^\d]/g, ''));
  useLayoutEffect(() => {
    const el = ref.current;
    const want = caret.current;
    caret.current = null;
    if (!el || want === null || document.activeElement !== el) return;
    let pos = 0;
    for (let seen = 0; pos < el.value.length && seen < want; pos++) {
      if (/\d/.test(el.value[pos]!)) seen++;
    }
    el.setSelectionRange(pos, pos);
  });
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <div className="input-money">
        <input
          ref={ref}
          id={fid}
          className={`input num${error ? ' invalid' : ''}`}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={!!error || undefined}
          value={shown}
          onChange={(e) => {
            const raw = e.target.value;
            const at = e.target.selectionStart ?? raw.length;
            caret.current = raw
              .slice(0, at)
              .replace(/[^\d]/g, '')
              .replace(/^0+(?=\d)/, '').length;
            onChange(raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''));
          }}
        />
        <span className="input-unit" aria-hidden>
          đ
        </span>
      </div>
    </Field>
  );
}

export function PasswordInput({ label, hint, error, id, ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <div className="input-wrap">
        <input
          id={fid}
          className={`input${error ? ' invalid' : ''}`}
          type={show ? 'text' : 'password'}
          aria-invalid={!!error || undefined}
          {...rest}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {show ? <Eye size={20} /> : <EyeOff size={20} />}
        </button>
      </div>
    </Field>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Tìm theo mã, tên hoặc đối tác',
  label = 'Tìm kiếm',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="search">
      <Search size={18} aria-hidden />
      <span className="sr-only">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="search"
      />
    </label>
  );
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const set = (i: number, d: string) => {
    const arr = digits.slice();
    arr[i] = d;
    onChange(arr.join('').slice(0, length));
  };
  return (
    <div className="otp" role="group" aria-label="Mã xác minh">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Chữ số ${i + 1}`}
          maxLength={1}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (v.length > 1) {
              onChange(v.slice(0, length));
              refs.current[Math.min(v.length, length) - 1]?.focus();
              return;
            }
            set(i, v);
            if (v && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const v = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
            if (v) {
              e.preventDefault();
              onChange(v);
              refs.current[Math.min(v.length, length) - 1]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}

// ───────── status ─────────
export type Tone = 'success' | 'warning' | 'neutral' | 'danger' | 'info';
export function Chip({
  tone = 'neutral',
  children,
  icon,
}: {
  tone?: Tone | string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span className={`chip ${tone === 'neutral' ? '' : tone}`}>
      {icon}
      {children}
    </span>
  );
}

export function Alert({
  tone = 'warning',
  children,
  title,
}: {
  tone?: 'warning' | 'info' | 'success' | 'danger';
  children: ReactNode;
  title?: ReactNode;
}) {
  const Icon =
    tone === 'success' ? Check : tone === 'info' ? Info : tone === 'danger' ? CircleAlert : TriangleAlert;
  return (
    <div className={`alert ${tone === 'warning' ? '' : tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={16} style={{ flex: 'none', marginTop: 1 }} aria-hidden />
      <div>
        {title && (
          <div className="strong" style={{ marginBottom: 4 }}>
            {title}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error?: ApiError | Error | undefined }) {
  if (!error) return null;
  return <Alert tone="danger">{error.message}</Alert>;
}

// ───────── page structure ─────────
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  period,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  period?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {(period || actions) && (
        <div className="page-actions">
          {period && <span className="period-chip">{period}</span>}
          {actions && (
            <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
              {actions}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  highlight?: boolean | undefined;
}) {
  return (
    <div className={`kpi${highlight ? ' highlight' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

export function KpiRow({
  items,
  action,
}: {
  items: { label: string; value: ReactNode; note?: ReactNode; highlight?: boolean | undefined }[];
  action?: ReactNode;
}) {
  return (
    <div
      className={`kpi-row${action ? ' with-action' : ''}`}
      data-n={items.length}
      style={{ ['--n' as string]: items.length }}
    >
      {items.map((k) => (
        <Kpi key={k.label} {...k} />
      ))}
      {action && <div className="kpi-action">{action}</div>}
    </div>
  );
}

export function KeyValues({
  rows,
  stacked,
}: {
  rows: { label: string; value: ReactNode }[];
  stacked?: boolean;
}) {
  return (
    <div className={`kv${stacked ? ' kv-stacked' : ''}`}>
      {rows.map((r) => (
        <div className="kv-row" key={r.label}>
          <span className="k">{r.label}</span>
          <span className="v">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Timeline({ items }: { items: { title: ReactNode; sub?: ReactNode; done?: boolean }[] }) {
  return (
    <ol className="timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((it, i) => (
        <li className="tl-item" key={i}>
          <span className={`tl-num${it.done ? ' done' : ''}`}>{it.done ? <Check size={14} /> : i + 1}</span>
          <div>
            <div className="tl-title">{it.title}</div>
            {it.sub && <div className="tl-sub">{it.sub}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CheckItem({ done, title, sub }: { done: boolean; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="check-item">
      <span
        className={`check-box${done ? '' : ' pending'}`}
        aria-label={done ? 'Đã hoàn tất' : 'Chưa hoàn tất'}
      >
        {done ? (
          <Check size={12} strokeWidth={3} />
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700 }}>!</span>
        )}
      </span>
      <div>
        <div className="check-title">{title}</div>
        {sub && <div className="check-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Empty({ children = 'Chưa có dữ liệu' }: { children?: ReactNode }) {
  return (
    <div className="empty">
      <FileX size={28} aria-hidden />
      {children}
    </div>
  );
}

function Skeleton({
  h = 18,
  w = '100%',
  style,
}: {
  h?: number;
  w?: number | string;
  style?: React.CSSProperties;
}) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden />;
}

export function PageLoading() {
  return (
    <div className="page" aria-busy="true" aria-label="Đang tải">
      <Skeleton h={14} w={90} />
      <Skeleton h={34} w={360} style={{ marginTop: 12 }} />
      <Skeleton h={14} w={280} style={{ marginTop: 12 }} />
      <div className="grid grid-3 mt-24">
        <Skeleton h={118} />
        <Skeleton h={118} />
        <Skeleton h={118} />
      </div>
      <Skeleton h={320} style={{ marginTop: 20 }} />
    </div>
  );
}

// ───────── table ─────────
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'right';
  strong?: boolean;
  width?: string;
}
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <Empty>{empty ?? 'Không có bản ghi phù hợp'}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.align === 'right' ? 'right' : undefined}
                style={c.width ? { width: c.width } : undefined}
                scope="col"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(r) : undefined) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.header}
                  className={
                    [c.align === 'right' ? 'right num' : '', c.strong ? 'strong' : ''].join(' ').trim() ||
                    undefined
                  }
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────── pagination ─────────
/** Page numbers to show: first, last, current ± 1, with gaps marked by null. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev > 1) out.push(p - prev === 2 ? p - 1 : null);
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
  unit = 'bản ghi',
  busy,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
  unit?: string;
  busy?: boolean;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pager" aria-label="Phân trang" aria-busy={busy || undefined}>
      <span className="pager-info">
        Hiển thị{' '}
        <b>
          {from}–{to}
        </b>{' '}
        trên <b>{total}</b> {unit}
      </span>
      <div className="pager-ctrl">
        {onPageSize && (
          <label className="pager-size">
            <span className="sr-only">Số dòng mỗi trang</span>
            <select className="select" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / trang
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="pager-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Trang trước"
        >
          <ChevronLeft size={16} />
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap${i}`} className="pager-gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              type="button"
              key={p}
              className={`pager-btn${p === page ? ' active' : ''}`}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Trang ${p}`}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="pager-btn"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          aria-label="Trang sau"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}

// ───────── modal ─────────
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  width,
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ───────── toasts ─────────
interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}
const ToastCtx = createContext<(kind: ToastItem['kind'], text: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.kind === 'success' ? (
              <Check size={16} />
            ) : t.kind === 'error' ? (
              <CircleAlert size={16} />
            ) : (
              <Info size={16} />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const ini =
    parts.length > 1
      ? parts[parts.length - 2]![0]! + parts[parts.length - 1]![0]!
      : (parts[0] ?? '?').slice(0, 2);
  return (
    <span className="avatar" aria-hidden>
      {ini.toUpperCase()}
    </span>
  );
}

/** Saves text as a file. Exports get a BOM so Excel reads UTF-8; originals pass bom: false (or their own BOM) to stay byte-exact. */
export function downloadText(
  filename: string,
  content: string,
  mime = 'text/csv;charset=utf-8',
  opts: { bom?: boolean } = {},
) {
  const blob = new Blob([(opts.bom ?? true) ? '﻿' + content : content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves a binary file produced by the app (e.g. an .xlsx workbook) exactly as built. */
export function downloadBase64(filename: string, contentBase64: string, mime: string) {
  const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(`Không đọc được tệp ${file.name}`));
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.readAsDataURL(file);
  });
}
