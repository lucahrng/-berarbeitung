import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseClient";

export async function POST(req: NextRequest) {
  const { candidateId, decision, reason } = await req.json();
  if (!candidateId || !["accepted", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { error: updateError } = await admin
    .from("candidates")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await admin.from("feedback_events").insert({ candidate_id: candidateId, decision, reason });

  return NextResponse.json({ ok: true });
}
