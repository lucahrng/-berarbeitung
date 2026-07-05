"use client";

import { useState } from "react";

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [log, setLog] = useState<{ time: string; text: string; ok: boolean }[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  async function runJob(endpoint: string) {
    if (!secret.trim()) {
      setLog((l) => [{ time: new Date().toLocaleTimeString("de-DE"), text: "Bitte Ingest-Secret eingeben.", ok: false }, ...l]);
      return;
    }
    setLoading(endpoint);
    try {
      const res = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingest-secret": secret.trim() },
      });
      const data = await res.json();
      setLog((l) => [
        { time: new Date().toLocaleTimeString("de-DE"), text: `${res.ok ? "✓" : "✗"} /api/${endpoint} (${res.status})\n${JSON.stringify(data, null, 2)}`, ok: res.ok },
        ...l,
      ]);
    } catch (e: any) {
      setLog((l) => [{ time: new Date().toLocaleTimeString("de-DE"), text: `✗ /api/${endpoint}: ${e.message}`, ok: false }, ...l]);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-8 max-w-2xl mx-auto">
      <h1 className="serif text-xl font-bold mb-1">Faktencheck-Inbox – Steuerung</h1>
      <p className="text-xs text-paper/50 mb-6">Löst die Hintergrund-Jobs deiner App aus</p>

      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 mb-4">
        <label className="text-xs text-paper/50 block mb-1.5">Ingest-Secret</label>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="dein INGEST_SECRET"
          className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-white/40"
        />
      </div>

      <div className="border border-white/10 rounded-xl p-4 mb-3">
        <h2 className="text-sm font-semibold mb-1">1. Mythen-Embeddings berechnen</h2>
        <p className="text-xs text-paper/55 mb-3">Einmalig nötig (und nach jedem neuen Mythos erneut).</p>
        <button
          onClick={() => runJob("embed-myths")}
          disabled={loading === "embed-myths"}
          className="w-full bg-paper text-ink rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {loading === "embed-myths" ? "läuft..." : "Embeddings berechnen"}
        </button>
      </div>

      <div className="border border-white/10 rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold mb-1">2. Videos einsammeln</h2>
        <p className="text-xs text-paper/55 mb-3">Sucht neue Kandidaten und speichert Treffer in Supabase.</p>
        <button
          onClick={() => runJob("ingest")}
          disabled={loading === "ingest"}
          className="w-full bg-accept rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {loading === "ingest" ? "läuft..." : "Videos einsammeln"}
        </button>
      </div>

      <div className="bg-[#0E1013] border border-white/10 rounded-xl p-3 font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-paper/40">Noch keine Aktion ausgeführt.</p>
        ) : (
          log.map((entry, i) => (
            <div key={i} className={`mb-2.5 pb-2.5 ${i < log.length - 1 ? "border-b border-white/[0.07]" : ""}`}>
              <span className="text-paper/35">{entry.time}</span>{" "}
              <span className={entry.ok ? "text-[#6FCF97]" : "text-[#EB5757]"}>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
