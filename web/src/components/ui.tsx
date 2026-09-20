import React from "react";

/* ------------------------------------------------------------------ tokens */

export const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  met: { bg: "bg-forest-light", text: "text-forest", dot: "bg-forest", label: "Met" },
  partial: { bg: "bg-ochre-light", text: "text-ochre", dot: "bg-ochre", label: "Partial" },
  unclear: { bg: "bg-slate2-light", text: "text-slate2", dot: "bg-slate2", label: "Unclear" },
  missing: { bg: "bg-brick-light", text: "text-brick", dot: "bg-brick", label: "Missing" },
};

export const GROUP_STYLE: Record<string, { bar: string; chip: string; note: string; ring: string }> = {
  Strong: {
    bar: "bg-gradient-to-r from-teal to-plum",
    chip: "bg-teal-light text-teal",
    note: "Must-have coverage ≥ 0.75, nothing missing",
    ring: "ring-teal/30",
  },
  Potential: {
    bar: "bg-gradient-to-r from-ochre to-[#E0A94B]",
    chip: "bg-ochre-light text-ochre",
    note: "Must-have coverage ≥ 0.45",
    ring: "ring-ochre/30",
  },
  Weak: {
    bar: "bg-gradient-to-r from-slate2 to-[#8797B0]",
    chip: "bg-slate2-light text-slate2",
    note: "Below the potential threshold",
    ring: "ring-slate2/25",
  },
};

/* ------------------------------------------------------------------ brand */

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="hf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6D28D9" />
          <stop offset="55%" stopColor="#4338CA" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#hf-g)" />
      <path d="M10 8.5v15M22 8.5v15M10 16h12" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="22" cy="16" r="3.4" fill="#fff" opacity=".9" />
      <path d="M20.6 16.1l1 1 1.9-2.1" stroke="#4338CA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  columns: <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="9.5" y="4" width="5" height="16" rx="1.5" /><rect x="16" y="4" width="5" height="16" rx="1.5" /></>,
  scale: <><path d="M12 4v16M7 8h10M5 8l-2.5 6h5zM19 8l-2.5 6h5z" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></>,
  bolt: <><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1-5.5A8 8 0 1 1 21 12z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  check: <><path d="M20 6L9 17l-5-5" /></>,
  x: <><path d="M18 6L6 18M6 6l12 12" /></>,
  download: <><path d="M12 3v12M7 11l5 5 5-5M4 20h16" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-1.6 5.6" /><path d="M20 4v7h-7" /></>,
  flag: <><path d="M5 21V4h13l-2.5 4L18 12H5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5S20 17 20 21" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
};

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name] || PATHS.spark}
    </svg>
  );
}

/* ------------------------------------------------------------------ chips */

export function StatusChip({ status, verified }: { status: string; verified?: boolean }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.unclear;
  return (
    <span className={`pill ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {verified === false && status !== "missing" && (
        <span title="Quote not found in source">⚠</span>
      )}
    </span>
  );
}

export function GroupChip({ group }: { group: string }) {
  const g = GROUP_STYLE[group];
  if (!g) return <span className="text-[12px] text-ink-300">Not screened</span>;
  return <span className={`pill ${g.chip}`}>{group}</span>;
}

export function Tag({ children, tone = "slate" }: { children: React.ReactNode; tone?: string }) {
  const map: Record<string, string> = {
    slate: "bg-slate2-light text-slate2",
    teal: "bg-teal-light text-teal",
    plum: "bg-plum-light text-plum",
    forest: "bg-forest-light text-forest",
    ochre: "bg-ochre-light text-ochre",
    brick: "bg-brick-light text-brick",
    cyan: "bg-cyanx-light text-cyanx",
  };
  return <span className={`pill ${map[tone] || map.slate}`}>{children}</span>;
}

/* ------------------------------------------------------------------ data viz */

export function ScoreDial({ value, size = 56 }: { value: number | null; size?: number }) {
  const v = value ?? 0;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const id = React.useId();
  const from = v >= 70 ? "#4338CA" : v >= 45 ? "#B45309" : "#64748B";
  const to = v >= 70 ? "#06B6D4" : v >= 45 ? "#E0A94B" : "#94A3B8";
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      setShown(v * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v]);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <defs>
        <linearGradient id={`d${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E9EDF7" strokeWidth="5" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`url(#d${id})`}
        strokeWidth="5"
        strokeDasharray={`${(c * shown) / 100} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="52%"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size / 3.4}
        fontWeight="700"
        fill="#0B1220"
      >
        {value === null ? "–" : Math.round(shown)}
      </text>
    </svg>
  );
}

export function CoverageBar({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const order = ["met", "partial", "unclear", "missing"];
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-paper-deep">
      {order.map((k) =>
        counts[k] ? (
          <div
            key={k}
            className={`${STATUS_STYLE[k].dot} transition-all duration-700`}
            style={{ width: `${(counts[k] / total) * 100}%` }}
            title={`${counts[k]} ${k}`}
          />
        ) : null
      )}
    </div>
  );
}

export function Meter({ value, tone = "teal" }: { value: number; tone?: string }) {
  const map: Record<string, string> = {
    teal: "from-teal to-cyanx",
    forest: "from-forest to-[#34D399]",
    ochre: "from-ochre to-[#E0A94B]",
    brick: "from-brick to-[#FB7185]",
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-paper-deep">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${map[tone] || map.teal} transition-all duration-700`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ layout */

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card animate-rise flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-teal-light text-teal">
        <Icon name="spark" className="h-5 w-5" />
      </span>
      <p className="font-serif text-xl">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-ink-500">{body}</p>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/15 border-t-teal" />
      {label}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card space-y-3 p-5">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-4/5" />
    </div>
  );
}

export function Section({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card animate-rise p-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end print:hidden">
      <div className="absolute inset-0 animate-fade bg-ink/35 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex h-full w-full max-w-xl animate-rise flex-col bg-white shadow-drawer"
      >
        <header className="flex items-center justify-between border-b border-ink/10 px-5 py-3.5">
          <h3 className="font-medium">{title}</h3>
          <button ref={closeRef} className="btn-quiet" onClick={onClose}>
            Close (Esc)
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

export function Highlighted({ text, start, end }: { text: string; start?: number | null; end?: number | null }) {
  if (start == null || end == null || end <= start) {
    return (
      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink-700">
        {text}
      </pre>
    );
  }
  const norm = text.replace(/\s+/g, " ").trim();
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink-700">
      {norm.slice(0, start)}
      <mark className="rounded bg-teal-light px-0.5 text-ink ring-1 ring-teal/30">{norm.slice(start, end)}</mark>
      {norm.slice(end)}
    </pre>
  );
}

/* ------------------------------------------------------------------ toast */

type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = React.createContext<(text: string, tone?: "ok" | "err") => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [list, setList] = React.useState<Toast[]>([]);
  const push = React.useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 print:hidden">
        {list.map((t) => (
          <div
            key={t.id}
            className={`animate-rise rounded-lg px-4 py-2.5 text-[13px] font-medium text-white shadow-lift ${
              t.tone === "err" ? "bg-brick" : "bg-ink"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
