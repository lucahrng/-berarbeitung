import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseClient";
import { getEmbedding } from "@/lib/embeddings";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-ingest-secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: myths, error } = await admin.from("myths").select("id, claim, embedding");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  for (const myth of myths ?? []) {
    if (myth.embedding) continue;
    const embedding = await getEmbedding(myth.claim);
    const { error: updErr } = await admin.from("myths").update({ embedding }).eq("id", myth.id);
    if (!updErr) updated++;
  }

  return NextResponse.json({ ok: true, updated, total: myths?.length ?? 0 });
}
