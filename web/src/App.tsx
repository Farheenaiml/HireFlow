import React, { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./lib/api";
import Dashboard from "./pages/Dashboard";
import NewRole from "./pages/NewRole";
import Board from "./pages/Board";
import CandidateDetail from "./pages/CandidateDetail";
import Interview from "./pages/Interview";
import Audit from "./pages/Audit";
import Compare from "./pages/Compare";
import ChatDock from "./components/ChatDock";
import { Icon, Logo } from "./components/ui";

type Ctx = {
  jobId: string | null;
  setJobId: (id: string | null) => void;
  reveal: boolean;
  setReveal: (v: boolean) => void;
  config: any;
  refreshConfig: () => void;
};
const AppCtx = createContext<Ctx>({} as Ctx);
export const useApp = () => useContext(AppCtx);

const NAV = [
  { to: "/", label: "Dashboard", icon: "grid", end: true },
  { to: "/role", label: "Role & requirements", icon: "doc" },
  { to: "/board", label: "Candidate board", icon: "columns" },
  { to: "/compare", label: "Compare", icon: "scale" },
  { to: "/audit", label: "Audit trail", icon: "shield" },
];

export default function App() {
  const [jobId, setJobId] = useState<string | null>(() => localStorage.getItem("hireflow.job"));
  const [reveal, setReveal] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    if (jobId) localStorage.setItem("hireflow.job", jobId);
    else localStorage.removeItem("hireflow.job");
  }, [jobId]);

  const refreshConfig = () => {
    api.config().then(setConfig).catch(() => {});
  };
  useEffect(() => { refreshConfig(); }, []);
  useEffect(() => { setNavOpen(false); }, [loc.pathname]);

  const orchestration =
    config && config.use_n8n && config.n8n_base_url
      ? config.n8n_reachable
        ? "n8n · live"
        : "n8n · unreachable"
      : "built-in runner";

  const sidebar = (
    <>
      <div className="px-2">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div>
            <p className="font-serif text-[23px] leading-none text-white">HireFlow</p>
            <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyanx">
              evidence first
            </p>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-snug text-ink-300">
          Screening you can audit. Every insight traces back to a quote we proved exists.
        </p>
      </div>

      <ul className="mt-7 space-y-1">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.end as any}
              className={({ isActive }) =>
                "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-200 " +
                (isActive
                  ? "bg-white/[.13] text-white"
                  : "text-ink-300 hover:bg-white/[.06] hover:text-white")
              }
            >
              <Icon name={n.icon} className="h-4 w-4 opacity-80" />
              <span className="truncate">{n.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3 pt-6 text-[12px] text-ink-300">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-white/[.06] px-3 py-2.5 text-paper transition-colors hover:bg-white/[.1]">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 accent-cyanx"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
          />
          <span>
            <span className="block font-medium text-white">Reveal identities</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-ink-300">
              Names and institutions are hidden from the model during screening.
            </span>
          </span>
        </label>

        <div className="space-y-1.5 rounded-lg border border-white/10 px-3 py-2.5">
          <Rail label="Engine" value={(config && config.model) || "…"} tone={config && config.llm_configured ? "live" : "idle"} />
          <Rail label="Orchestration" value={orchestration} tone={config && config.use_n8n && config.n8n_reachable ? "live" : "idle"} />
          <Rail label="Prompts" value={(config && config.prompt_version) || "…"} tone="idle" />
        </div>
      </div>
    </>
  );

  return (
    <AppCtx.Provider value={{ jobId, setJobId, reveal, setReveal, config, refreshConfig }}>
      <div className="flex min-h-screen">
        <nav
          aria-label="Main"
          className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-ink-deep px-4 py-6 text-paper md:flex print:hidden"
        >
          {sidebar}
        </nav>

        {navOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden print:hidden">
            <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={() => setNavOpen(false)} />
            <nav
              aria-label="Main"
              className="relative flex h-full w-[264px] animate-rise flex-col bg-ink-deep px-4 py-6 text-paper"
            >
              {sidebar}
            </nav>
          </div>
        )}

        <main id="main" className="min-w-0 flex-1">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
          >
            Skip to content
          </a>

          <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink/10 bg-white/80 px-4 py-3 backdrop-blur-xl md:hidden print:hidden">
            <button className="btn-ghost !px-2.5 !py-1.5" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Icon name="menu" className="h-4 w-4" />
            </button>
            <Logo size={26} />
            <span className="font-serif text-[19px]">HireFlow</span>
          </div>

          <div className="mx-auto max-w-[1220px] px-4 py-6 md:px-9 md:py-9">
            <FairnessBanner config={config} />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/role" element={<NewRole />} />
              <Route path="/board" element={<Board />} />
              <Route path="/candidate/:id" element={<CandidateDetail />} />
              <Route path="/candidate/:id/interview" element={<Interview />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/audit" element={<Audit />} />
            </Routes>
          </div>
        </main>

        {jobId && !loc.pathname.includes("/interview") && (
          <div className="print:hidden">
            <ChatDock jobId={jobId} />
          </div>
        )}
      </div>
    </AppCtx.Provider>
  );
}

function Rail({ label, value, tone }: { label: string; value: string; tone: "live" | "idle" }) {
  return (
    <p className="flex items-center justify-between gap-2 leading-tight">
      <span className="text-ink-300">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-paper">
        <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + (tone === "live" ? "bg-forest" : "bg-ink-300")} />
        <span className="truncate font-mono text-[11px]">{value}</span>
      </span>
    </p>
  );
}

function FairnessBanner({ config }: { config: any }) {
  const s = config && config.scoring;
  return (
    <div
      role="note"
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-teal/15 bg-gradient-to-r from-teal-light/70 via-plum-light/50 to-cyanx-light/40 px-4 py-2.5 text-[12px] text-teal print:hidden"
    >
      <span className="pill bg-white/70 font-semibold text-teal">
        <span className="h-1.5 w-1.5 rounded-full bg-teal" />
        Blind screening on
      </span>
      <span className="text-ink-700">
        Names, contact details and institutions are stripped before the model reads anything.
      </span>
      <span
        className="ml-auto cursor-help border-b border-dashed border-teal/40 text-teal"
        title={
          s
            ? "met 1.0 · partial 0.5 · unclear 0.25 · missing 0 · must-haves " +
              s.weights.must * 100 +
              "% / nice " +
              s.weights.nice * 100 +
              "% · Strong ≥ " +
              s.strong_must_score +
              " with no missing must-have · Potential ≥ " +
              s.potential_must_score
            : "Scoring is deterministic code"
        }
      >
        Scoring rule: deterministic code ⓘ
      </span>
    </div>
  );
}
