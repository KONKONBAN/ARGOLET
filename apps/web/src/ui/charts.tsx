import { useMemo, useRef, useState } from 'react';

/**
 * Two-series line chart (Thu / Chi) with legend, end labels, hover crosshair + tooltip
 * and an accessible table fallback. Palette validated (green #087452 / blue #3E78D6,
 * CVD ΔE ≥ 13). 2px lines, ≥8px markers with surface ring, hairline grid.
 */
export interface LinePoint {
  label: string;
  inflow: number;
  outflow: number;
}

const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

export function CashflowLineChart({ data, unit = 'triệu đồng' }: { data: LinePoint[]; unit?: string }) {
  const W = 680;
  const H = 230;
  const pad = { l: 34, r: 56, t: 10, b: 30 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const maxV = Math.max(10, ...data.flatMap((d) => [d.inflow, d.outflow]));
  const step = maxV > 40 ? 20 : 10;
  const top = Math.ceil(maxV / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (data.length - 1));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const path = (key: 'inflow' | 'outflow') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const last = data.length - 1;
  const series = useMemo(
    () => [
      { key: 'inflow' as const, name: 'Thu', color: 'var(--chart-in)' },
      { key: 'outflow' as const, name: 'Chi', color: 'var(--chart-out)' },
    ],
    [],
  );
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    data.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setHover(best);
  };
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Dòng tiền thu và chi theo ngày, đơn vị ${unit}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={d.label} x={x(i)} y={H - 8} textAnchor="middle">
            {d.label}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#b9c7cf" strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) => (
              <circle key={i} cx={x(i)} cy={y(d[s.key])} r={hover === i ? 5 : 4} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
            {last >= 0 && (
              <text x={x(last) + 10} y={y(data[last]![s.key]) + 4} style={{ fill: 'var(--text)', fontWeight: 600 }}>
                {s.name} {fmt(data[last]![s.key])}
              </text>
            )}
          </g>
        ))}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" />
      </svg>
      {hover !== null && data[hover] && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(Math.min(y(data[hover]!.inflow), y(data[hover]!.outflow)) / H) * 100}%` }}>
          <div className="strong" style={{ marginBottom: 4 }}>{data[hover]!.label}</div>
          {series.map((s) => (
            <div className="tip-row" key={s.key}>
              <i style={{ background: s.color }} /> {s.name}: {fmt(data[hover]![s.key])} {unit === 'triệu đồng' ? 'tr' : unit}
            </div>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>Dòng tiền theo ngày ({unit})</caption>
        <thead>
          <tr>
            <th>Ngày</th>
            <th>Thu</th>
            <th>Chi</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{fmt(d.inflow)}</td>
              <td>{fmt(d.outflow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartLegend() {
  return (
    <div className="legend" aria-hidden>
      <span>
        <i style={{ background: 'var(--chart-in)' }} />
        Thu
      </span>
      <span>
        <i style={{ background: 'var(--chart-out)' }} />
        Chi
      </span>
    </div>
  );
}

/** Project cash flow columns: negative investment below the zero line, inflows above. */
export function CashflowColumns({ flows }: { flows: number[] }) {
  const W = 560;
  const H = 180;
  const zeroY = 60;
  const maxPos = Math.max(1, ...flows.filter((f) => f > 0));
  const maxNeg = Math.max(1, ...flows.filter((f) => f < 0).map((f) => -f));
  const slot = W / flows.length;
  const bw = Math.min(24, slot * 0.4);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dòng tiền dự án theo năm, đơn vị triệu đồng">
        <line className="grid-line" x1={0} x2={W} y1={zeroY} y2={zeroY} />
        {flows.map((f, i) => {
          const cx = slot * i + slot / 2;
          const h = f >= 0 ? (f / maxPos) * 34 : (-f / maxNeg) * 90;
          const yTop = f >= 0 ? zeroY - h : zeroY;
          const color = f >= 0 ? 'var(--chart-in)' : 'var(--brand)';
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - slot / 2} y={0} width={slot} height={H} fill="transparent" />
              <path
                d={
                  f >= 0
                    ? `M${cx - bw / 2},${zeroY} V${yTop + 4} Q${cx - bw / 2},${yTop} ${cx - bw / 2 + 4},${yTop} H${cx + bw / 2 - 4} Q${cx + bw / 2},${yTop} ${cx + bw / 2},${yTop + 4} V${zeroY} Z`
                    : `M${cx - bw / 2},${zeroY} V${zeroY + h - 4} Q${cx - bw / 2},${zeroY + h} ${cx - bw / 2 + 4},${zeroY + h} H${cx + bw / 2 - 4} Q${cx + bw / 2},${zeroY + h} ${cx + bw / 2},${zeroY + h - 4} V${zeroY} Z`
                }
                fill={color}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
              <text x={cx} y={f >= 0 ? yTop - 8 : zeroY + h + 14} textAnchor="middle" style={{ fill: 'var(--text)' }}>
                {f > 0 ? '+' : f < 0 ? '−' : ''}
                {Math.abs(f).toLocaleString('vi-VN')}
              </text>
              <text x={cx} y={H - 4} textAnchor="middle">
                Năm {i}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Dòng tiền dự án (triệu đồng)</caption>
        <tbody>
          {flows.map((f, i) => (
            <tr key={i}>
              <td>Năm {i}</td>
              <td>{f}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
