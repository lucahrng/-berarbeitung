import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseClient";
import { ingestApifyPlatform, PLATFORM_CONFIGS, MythRow } from "@/lib/ingestPlatforms";

export const maxDuration = 60;

function withCORS(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, x-ingest-secret");
  return res;
}

export async function OPTIONS() {
  return withCORS(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-ingest-secret");
  if (secret !== process.env.INGEST_SECRET) {
    return withCORS(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  }

  if (!process.env.APIFY_TOKEN) {
    return withCORS(NextResponse.json({ error: "APIFY_TOKEN fehlt" }, { status: 400 }));
  }

  const admin = supabaseAdmin();
  const { data: myths } = await admin.from("myths").select("id, claim, fact, embedding");
  if (!myths?.length) return withCORS(NextResponse.json({ error: "keine myths in DB" }, { status: 400 }));

  const missingEmbeddings = myths.filter((m: MythRow) => !m.embedding).length;
  if (missingEmbeddings > 0) {
    return withCORS(NextResponse.json(
      { error: `${missingEmbeddings} Mythen ohne Embedding. Erst POST /api/embed-myths aufrufen.` },
      { status: 400 }
    ));
  }

  let inserted = 0;
  const errors: string[] = [];
  const platformStats: Record<string, unknown> = {};

  for (const platform of ["linkedin", "x"]) {
    try {
      const config = PLATFORM_CONFIGS[platform];
      const actorId = process.env[config.actorEnvVar] || config.defaultActorId;
      const r = await ingestApifyPlatform({
        admin, myths, platform, actorId,
        input: config.buildInput(),
        mapItem: config.mapItem,
      });
      inserted += r.inserted;
      platformStats[platform] = r;
    } catch (e: any) {
      errors.push(`${platform}: ${e.message}`);
    }
  }

  return withCORS(NextResponse.json({ ok: true, inserted, errors, platformStats }));
}
