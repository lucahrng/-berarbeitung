import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseClient";
import { computePriorityScore, computeReachScore, MATCH_CONFIDENCE_THRESHOLD } from "@/lib/scoring";
import { getEmbedding, cosineSimilarity, parseEmbedding } from "@/lib/embeddings";
import { runApifyActor } from "@/lib/apify";

const SEARCH_QUERIES = [
  "Honig macht nicht dick",
  "Datteln kein Zucker",
  "Frühstück wichtigste Mahlzeit",
  "Süßstoffe ungesund krebserregend",
  "Kohlenhydrate abends dick",
];

const HASHTAGS = ["ernaehrungsmythen", "abnehmen", "ernaehrung", "fitnessmythen", "gesundheit"];

type MythRow = {
  id: string;
  claim: string;
  embedding: unknown;
};

function findBestMythMatch(videoEmbedding: number[], myths: MythRow[]) {
  let best: { mythId: string; similarity: number } | null = null;
  for (const myth of myths) {
    const emb = parseEmbedding(myth.embedding);
    if (!emb) continue;
    const sim = cosineSimilarity(videoEmbedding, emb);
    if (!best || sim > best.similarity) best = { mythId: myth.id, similarity: sim };
  }
  return best;
}

async function upsertCandidate(admin: any, row: Record<string, unknown>) {
  const { error } = await admin
    .from("candidates")
    .upsert(row, { onConflict: "platform,external_id" });
  return !error;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-ingest-secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: myths } = await admin.from("myths").select("id, claim, fact, embedding");
  if (!myths?.length) return NextResponse.json({ error: "keine myths in DB" }, { status: 400 });

  const missingEmbeddings = myths.filter((m: MythRow) => !m.embedding).length;
  if (missingEmbeddings > 0) {
    return NextResponse.json(
      { error: `${missingEmbeddings} Mythen ohne Embedding. Erst POST /api/embed-myths aufrufen.` },
      { status: 400 }
    );
  }

  let inserted = 0;
  const errors: string[] = [];

  // ---------- YouTube ----------
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    for (const query of SEARCH_QUERIES) {
      try {
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&relevanceLanguage=de&maxResults=10&q=${encodeURIComponent(query)}&key=${apiKey}`;
        const searchData = await (await fetch(searchUrl)).json();
        if (!searchData.items) continue;

        const videoIds = searchData.items.map((it: any) => it.id.videoId).join(",");
        const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${apiKey}`;
        const statsData = await (await fetch(statsUrl)).json();

        for (const item of statsData.items ?? []) {
          const title: string = item.snippet.title;
          const description: string = item.snippet.description ?? "";
          const combined = `${title}. ${description}`.slice(0, 2000);

          const videoEmbedding = await getEmbedding(combined);
          const match = findBestMythMatch(videoEmbedding, myths);
          if (!match || match.similarity < MATCH_CONFIDENCE_THRESHOLD) continue;

          const views = Number(item.statistics.viewCount ?? 0);
          const likes = Number(item.statistics.likeCount ?? 0);
          const comments = Number(item.statistics.commentCount ?? 0);
          const postedAt = item.snippet.publishedAt;

          const priority = computePriorityScore({
            views, likes, comments, shares: 0, postedAt, matchConfidence: match.similarity,
          });
          if (priority === 0) continue;

          const ok = await upsertCandidate(admin, {
            platform: "youtube",
            external_id: item.id,
            url: `https://www.youtube.com/watch?v=${item.id}`,
            creator: item.snippet.channelTitle,
            title,
            excerpt: description.slice(0, 280),
            thumbnail_url: item.snippet.thumbnails?.medium?.url,
            views, likes, comments, shares: 0,
            posted_at: postedAt,
            myth_id: match.mythId,
            match_confidence: match.similarity,
            reach_score: computeReachScore(views),
            priority_score: priority,
          });
          if (ok) inserted++;
        }
      } catch (e: any) {
        errors.push(`youtube:${query}: ${e.message}`);
      }
    }
  } else {
    errors.push("YOUTUBE_API_KEY fehlt - YouTube uebersprungen");
  }

  // ---------- TikTok (via Apify) ----------
  if (process.env.APIFY_TOKEN) {
    try {
      const actorId = process.env.APIFY_TIKTOK_ACTOR_ID || "clockworks/tiktok-scraper";
      const items: any[] = await runApifyActor(actorId, {
        hashtags: HASHTAGS,
        resultsPerPage: 15,
      });

      for (const item of items ?? []) {
        const caption: string = item.text ?? item.desc ?? "";
        if (!caption) continue;

        const videoEmbedding = await getEmbedding(caption.slice(0, 2000));
        const match = findBestMythMatch(videoEmbedding, myths);
        if (!match || match.similarity < MATCH_CONFIDENCE_THRESHOLD) continue;

        const views = Number(item.playCount ?? item.views ?? 0);
        const likes = Number(item.diggCount ?? item.likes ?? 0);
        const comments = Number(item.commentCount ?? item.comments ?? 0);
        const shares = Number(item.shareCount ?? item.shares ?? 0);
        const postedAt = item.createTimeISO ?? new Date().toISOString();
        const externalId = item.id ?? item.webVideoUrl ?? caption.slice(0, 40);

        const priority = computePriorityScore({
          views, likes, comments, shares, postedAt, matchConfidence: match.similarity,
        });
        if (priority === 0) continue;

        const ok = await upsertCandidate(admin, {
          platform: "tiktok",
          external_id: String(externalId),
          url: item.webVideoUrl ?? item.url ?? "",
          creator: item.authorMeta?.name ?? item.author ?? "unbekannt",
          title: caption.slice(0, 120),
          excerpt: caption.slice(0, 280),
          thumbnail_url: item.covers?.default ?? item.videoMeta?.coverUrl,
          views, likes, comments, shares,
          posted_at: postedAt,
          myth_id: match.mythId,
          match_confidence: match.similarity,
          reach_score: computeReachScore(views),
          priority_score: priority,
        });
        if (ok) inserted++;
      }
    } catch (e: any) {
      errors.push(`tiktok: ${e.message}`);
    }

    // ---------- Instagram (via Apify) ----------
    try {
      const actorId = process.env.APIFY_INSTAGRAM_ACTOR_ID || "apify/instagram-hashtag-scraper";
      const items: any[] = await runApifyActor(actorId, {
        hashtags: HASHTAGS,
        resultsLimit: 15,
      });

      for (const item of items ?? []) {
        const caption: string = item.caption ?? "";
        if (!caption) continue;

        const videoEmbedding = await getEmbedding(caption.slice(0, 2000));
        const match = findBestMythMatch(videoEmbedding, myths);
        if (!match || match.similarity < MATCH_CONFIDENCE_THRESHOLD) continue;

        const views = Number(item.videoViewCount ?? item.videoPlayCount ?? 0);
        const likes = Number(item.likesCount ?? 0);
        const comments = Number(item.commentsCount ?? 0);
        const postedAt = item.timestamp ?? new Date().toISOString();
        const externalId = item.id ?? item.shortCode ?? caption.slice(0, 40);

        const priority = computePriorityScore({
          views, likes, comments, shares: 0, postedAt, matchConfidence: match.similarity,
        });
        if (priority === 0) continue;

        const ok = await upsertCandidate(admin, {
          platform: "instagram",
          external_id: String(externalId),
          url: item.url ?? "",
          creator: item.ownerUsername ?? "unbekannt",
          title: caption.slice(0, 120),
          excerpt: caption.slice(0, 280),
          thumbnail_url: item.displayUrl,
          views, likes, comments, shares: 0,
          posted_at: postedAt,
          myth_id: match.mythId,
          match_confidence: match.similarity,
          reach_score: computeReachScore(views),
          priority_score: priority,
        });
        if (ok) inserted++;
      }
    } catch (e: any) {
      errors.push(`instagram: ${e.message}`);
    }
  } else {
    errors.push("APIFY_TOKEN fehlt - TikTok/Instagram uebersprungen");
  }

  return NextResponse.json({ ok: true, inserted, errors });
}
