import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseClient";
import { computePriorityScore, computeReachScore, MATCH_CONFIDENCE_THRESHOLD } from "@/lib/scoring";
import { getEmbedding } from "@/lib/embeddings";
import { findBestMythMatch, upsertCandidate, ingestApifyPlatform, PLATFORM_CONFIGS, MythRow, SEARCH_QUERIES, getMythWeights, applyLearnedWeight } from "@/lib/ingestPlatforms";

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

type YoutubeItem = {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  thumbnailUrl?: string;
  views: number;
  likes: number;
  comments: number;
  postedAt: string;
};

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-ingest-secret");
  if (secret !== process.env.INGEST_SECRET) {
    return withCORS(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
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
  const mythWeights = await getMythWeights(admin);

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const allItems: YoutubeItem[] = [];
      await Promise.all(
        SEARCH_QUERIES.map(async (query) => {
          try {
            const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&relevanceLanguage=de&maxResults=4&q=${encodeURIComponent(query)}&key=${apiKey}`;
            const searchData = await (await fetch(searchUrl)).json();
            if (!searchData.items) return;

            const videoIds = searchData.items.map((it: any) => it.id.videoId).join(",");
            const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${apiKey}`;
            const statsData = await (await fetch(statsUrl)).json();

            for (const item of statsData.items ?? []) {
              allItems.push({
                id: item.id,
                title: item.snippet.title,
                description: item.snippet.description ?? "",
                channelTitle: item.snippet.channelTitle,
                thumbnailUrl: item.snippet.thumbnails?.medium?.url,
                views: Number(item.statistics.viewCount ?? 0),
                likes: Number(item.statistics.likeCount ?? 0),
                comments: Number(item.statistics.commentCount ?? 0),
                postedAt: item.snippet.publishedAt,
              });
            }
          } catch (e: any) {
            errors.push(`youtube:${query}: ${e.message}`);
          }
        })
      );

      const embeddings = await Promise.all(
        allItems.map((it) => getEmbedding(`${it.title}. ${it.description}`.slice(0, 2000)))
      );

      let youtubeInserted = 0;
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const match = findBestMythMatch(embeddings[i], myths);
        if (!match || match.similarity < MATCH_CONFIDENCE_THRESHOLD) continue;

        const rawPriority = computePriorityScore({
          views: item.views, likes: item.likes, comments: item.comments, shares: 0,
          postedAt: item.postedAt, matchConfidence: match.similarity,
        });
        if (rawPriority === 0) continue;
        const priority = applyLearnedWeight(rawPriority, mythWeights[match.mythId]);

        const ok = await upsertCandidate(admin, {
          platform: "youtube",
          external_id: item.id,
          url: `https://www.youtube.com/watch?v=${item.id}`,
          creator: item.channelTitle,
          title: item.title,
          excerpt: item.description.slice(0, 280),
          thumbnail_url: item.thumbnailUrl,
          views: item.views, likes: item.likes, comments: item.comments, shares: 0,
          posted_at: item.postedAt,
          myth_id: match.mythId,
          match_confidence: match.similarity,
          reach_score: computeReachScore(item.views),
          priority_score: priority,
        });
        if (ok) { inserted++; youtubeInserted++; }
      }
      platformStats.youtube = { inserted: youtubeInserted, totalItems: allItems.length };
    } catch (e: any) {
      errors.push(`youtube: ${e.message}`);
    }
  } else {
    errors.push("YOUTUBE_API_KEY fehlt - YouTube uebersprungen");
  }

  if (process.env.APIFY_TOKEN) {
    for (const platform of ["instagram", "tiktok"]) {
      try {
        const config = PLATFORM_CONFIGS[platform];
        const actorId = process.env[config.actorEnvVar] || config.defaultActorId;
        const r = await ingestApifyPlatform({
          admin, myths, platform, actorId,
          input: config.buildInput(),
          mapItem: config.mapItem,
          mythWeights,
        });
        inserted += r.inserted;
        platformStats[platform] = r;
      } catch (e: any) {
        errors.push(`${platform}: ${e.message}`);
      }
    }
  } else {
    errors.push("APIFY_TOKEN fehlt - Instagram/TikTok uebersprungen");
  }

  return withCORS(NextResponse.json({ ok: true, inserted, errors, platformStats }));
}
