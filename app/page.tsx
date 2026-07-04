"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  Youtube,
  Instagram,
  Music2,
  Eye,
  MessageCircle,
  Check,
  X,
  ExternalLink,
  Download,
  Filter,
  ChevronDown,
  Stamp,
  Sparkles,
  Copy,
  Loader2,
  Inbox as InboxIcon,
} from "lucide-react";

const PLATFORM_META: Record<string, { label: string; icon: any; color: string }> = {
  youtube: { label: "YouTube", icon: Youtube, color: "#E23F44" },
  tiktok: { label: "TikTok", icon: Music2, color: "#00C2B8" },
  instagram: { label: "Instagram", icon: Instagram, color: "#C1447E" },
};

function formatNum(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "K";
  return String(n ?? 0);
}

type Myth = {
  id: string;
  claim: string;
  fact: string;
  hook: string;
  argumentation: string[];
  sources: { name: string; url: string }[];
};

type Candidate = {
  id: string;
  platform: string;
  url: string;
  creator: string;
  title: string;
  excerpt: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  posted_at: string;
  priority_score: number;
  status: "pending" | "accepted" | "rejected";
  myth: Myth | null;
};

export default function Page() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"inbox" | "accepted" | "rejected">("inbox");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sortBy, setSortBy] = useState("priority");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("candidates")
      .select("*, myth:myths(*)")
      .order("priority_score", { ascending: false });
    if (!error && data) setCandidates(data as unknown as Candidate[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("candidates-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "candidates" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function decide(candidate: Candidate, decision: "accepted" | "rejected") {
    setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, status: decision } : c)));
    setSelected(null);
    setToast(decision === "accepted" ? "Angenommen – danke, das schärft das Ranking." : "Abgelehnt – wird berücksichtigt.");
    setTimeout(() => setToast(null), 2200);
    await fetch("/api/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id, decision }),
    });
  }

  const filtered = useMemo(() => {
    let list = candidates.filter((c) => (tab === "inbox" ? c.status === "pending" : c.status === tab));
    if (platformFilter !== "all") list = list.filter((c) => c.platform === platformFilter);
    if (sortBy === "priority") list = [...list].sort((a, b) => b.priority_score - a.priority_score);
    if (sortBy === "reach") list = [...list].sort((a, b) => b.views - a.views);
    if (sortBy === "new") list = [...list].sort((a, b) => +new Date(b.posted_at) - +new Date(a.posted_at));
    return list;
  }, [candidates, tab, platformFilter, sortBy]);

  const inboxCount = candidates.filter((c) => c.status === "pending").length;
  const acceptedList = candidates.filter((c) => c.status === "accepted");

  function exportCSV() {
    const rows = [
      ["Plattform", "Creator", "Titel", "Falschaussage", "Views", "Priorität", "URL"],
      ...acceptedList.map((c) => [
        PLATFORM_META[c.platform]?.label ?? c.platform,
        c.creator,
        c.title,
        c.myth?.claim ?? "",
        String(c.views),
        String(c.priority_score),
        c.url,
      ]),
    ];
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "faktencheck-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-white/10 sticky top-0 bg-ink/95 backdrop-blur z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-flag flex items-center justify-center shrink-0">
              <Stamp size={18} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="serif text-lg sm:text-xl font-bold leading-tight">Faktencheck-Inbox</h1>
              <p className="text-[11px] sm:text-xs text-paper/50 -mt-0.5">für Chris · Ernährung, Fitness & Gesundheit</p>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-2xl font-bold serif tabular-nums">{inboxCount}</div>
            <div className="text-[11px] text-paper/50">offene Vorschläge</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-5">
        <div className="flex items-center gap-1 mb-4 bg-white/5 rounded-lg p-1 w-fit">
          {[
            { key: "inbox", label: `Inbox (${inboxCount})` },
            { key: "accepted", label: "Angenommen" },
            { key: "rejected", label: "Abgelehnt" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
                tab === t.key ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="flex items-center gap-1.5 text-paper/40 text-xs pr-1">
            <Filter size={13} /> Plattform:
          </div>
          {["all", "youtube", "tiktok", "instagram"].map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`px-2.5 py-1 rounded-full text-xs border transition ${
                platformFilter === p ? "bg-paper text-ink border-paper" : "border-white/15 text-paper/60 hover:border-white/30"
              }`}
            >
              {p === "all" ? "Alle" : PLATFORM_META[p].label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="appearance-none bg-white/5 border border-white/15 rounded-full text-xs pl-3 pr-7 py-1.5 outline-none cursor-pointer"
              >
                <option value="priority" className="bg-ink">Priorität</option>
                <option value="reach" className="bg-ink">Reichweite</option>
                <option value="new" className="bg-ink">Neueste</option>
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
            </div>
            {tab === "accepted" && acceptedList.length > 0 && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-1.5 text-xs bg-white/5 border border-white/15 rounded-full px-3 py-1.5 hover:bg-white/10 transition"
              >
                <Download size={13} /> Export
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20 opacity-40">
            <Loader2 className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-white/10 rounded-xl">
            <InboxIcon className="mx-auto mb-3 opacity-30" size={28} />
            <p className="text-sm text-paper/50">
              {tab === "inbox"
                ? "Keine offenen Vorschläge. Lauf den Ingest-Job (/api/ingest) oder passe die Filter an."
                : "Noch nichts hier."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => {
              const meta = PLATFORM_META[c.platform];
              const Icon = meta?.icon ?? Youtube;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-xl p-4 cursor-pointer transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color + "22" }}>
                      <Icon size={16} style={{ color: meta.color }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-paper/45 mb-1">
                        <span>{meta.label}</span>
                        <span>·</span>
                        <span>{c.creator}</span>
                      </div>
                      <p className="text-sm font-semibold leading-snug truncate">{c.title}</p>
                      {c.myth && (
                        <div className="mt-2 inline-flex items-start gap-1.5 bg-flag/10 border border-flag/30 rounded-md px-2 py-1">
                          <span className="stamp text-[9px] font-extrabold shrink-0 px-1 mt-0.5">FALSCH</span>
                          <span className="text-xs text-paper/80 leading-snug">{c.myth.claim}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <div className="text-lg font-bold serif tabular-nums">{c.priority_score}</div>
                      <div className="text-[10px] text-paper/40">Priorität</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                    <div className="flex items-center gap-4 text-xs text-paper/50">
                      <span className="flex items-center gap-1"><Eye size={12} /> {formatNum(c.views)}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={12} /> {formatNum(c.comments)}</span>
                      <span className="sm:hidden font-bold text-paper/80">Prio {c.priority_score}</span>
                    </div>
                    {tab === "inbox" && (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => decide(c, "rejected")}
                          className="w-7 h-7 rounded-full border border-white/15 flex items-center justify-center hover:bg-white/10 hover:border-white/30 transition"
                        >
                          <X size={13} />
                        </button>
                        <button
                          onClick={() => decide(c, "accepted")}
                          className="w-7 h-7 rounded-full bg-accept flex items-center justify-center hover:brightness-110 transition"
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {selected && <DetailModal candidate={selected} onClose={() => setSelected(null)} onDecide={decide} />}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-paper text-ink text-sm px-4 py-2.5 rounded-full shadow-lg font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function DetailModal({
  candidate,
  onClose,
  onDecide,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDecide: (c: Candidate, d: "accepted" | "rejected") => void;
}) {
  const [showCorrection, setShowCorrection] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = PLATFORM_META[candidate.platform];
  const Icon = meta?.icon ?? Youtube;
  const myth = candidate.myth;

  const correctionText = myth
    ? `HOOK\n${myth.hook}\n\nEINSTIEG\nIm Video wird behauptet: „${myth.claim}"\n\nARGUMENTATION\n${myth.argumentation
        .map((a, i) => `${i + 1}. ${a}`)
        .join("\n")}\n\nRICHTIGSTELLUNG\n${myth.fact}\n\nQUELLEN\n${myth.sources.map((s) => `- ${s.name}`).join("\n")}`
    : "";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#181B21] border border-white/10 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <a href={candidate.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-paper/50 hover:text-paper">
              <Icon size={14} style={{ color: meta?.color }} />
              {meta?.label} · {candidate.creator} <ExternalLink size={11} />
            </a>
            <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center">
              <X size={15} />
            </button>
          </div>

          <h2 className="serif text-lg font-bold leading-snug mb-3">{candidate.title}</h2>

          {candidate.excerpt && (
            <div className="bg-white/5 rounded-lg p-3 mb-3">
              <p className="text-xs text-paper/40 mb-1">Ausschnitt</p>
              <p className="text-sm text-paper/75 italic leading-relaxed">{candidate.excerpt}</p>
            </div>
          )}

          <div className="flex gap-4 text-xs text-paper/50 mb-4">
            <span className="flex items-center gap-1"><Eye size={12} /> {formatNum(candidate.views)} Views</span>
            <span>Priorität: <b className="text-paper">{candidate.priority_score}</b></span>
          </div>

          {myth && (
            <>
              <div className="border border-flag/30 bg-flag/10 rounded-lg p-3 mb-4">
                <p className="stamp text-[10px] font-extrabold inline-block px-1.5 mb-1.5">FALSCHAUSSAGE</p>
                <p className="text-sm font-medium mb-1.5">{myth.claim}</p>
                <p className="text-xs text-paper/60 leading-relaxed">{myth.fact}</p>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {myth.sources.map((s) => (
                  <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-2.5 py-1 transition">
                    {s.name} <ExternalLink size={10} />
                  </a>
                ))}
              </div>

              {!showCorrection ? (
                <button onClick={() => setShowCorrection(true)} className="w-full flex items-center justify-center gap-2 bg-paper text-ink rounded-lg py-2.5 text-sm font-semibold hover:bg-white transition mb-3">
                  <Sparkles size={15} /> Korrektur-Baustein generieren
                </button>
              ) : (
                <div className="bg-white/[0.04] border border-white/10 rounded-lg p-4 mb-3 text-sm leading-relaxed space-y-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-paper/40 mb-1">Hook</p>
                    <p>{myth.hook}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-paper/40 mb-1">Argumentation</p>
                    <ol className="list-decimal list-inside space-y-1 text-paper/85">
                      {myth.argumentation.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ol>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(correctionText);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/15 rounded-full px-3 py-1.5 transition"
                  >
                    <Copy size={12} /> {copied ? "Kopiert!" : "Als Text kopieren"}
                  </button>
                </div>
              )}
            </>
          )}

          {candidate.status === "pending" && (
            <div className="flex gap-2">
              <button onClick={() => onDecide(candidate, "rejected")} className="flex-1 flex items-center justify-center gap-1.5 border border-white/15 rounded-lg py-2 text-sm hover:bg-white/5 transition">
                <X size={14} /> Ablehnen
              </button>
              <button onClick={() => onDecide(candidate, "accepted")} className="flex-1 flex items-center justify-center gap-1.5 bg-accept rounded-lg py-2 text-sm font-medium hover:brightness-110 transition">
                <Check size={14} /> Annehmen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
