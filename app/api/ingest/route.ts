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

function withCORS(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, x-ingest-secret");
  return res;
}

export async function OPTIONS() {
  return withCORS(new NextResponse(null, { status: 204 }));
}

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

async function ingestApifyPlatform(opts: {
  admin: any;
  myths: MythRow[];
  platform: string;
  actorId: string;
  input: Record<string, unknown>;
  mapItem: (item: any) => {
    text: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    postedAt: string;
    externalId: string;
    url: string;
    creator: string;
    thumbnailUrl?: string;
  } | null;
}) {
  const { admin, myths, platform, actorId, input, mapItem } = opts;
  let inserted = 0;
  let matched = 0;
  const items: any[] = await runApifyActor(actorId, input);
  const totalItems = items?.length ?? 0;
  const sampleKeys = totalItems > 0 ? Object.keys(items[0]) : [];

  for (const raw of items ?? []) {
    const mapped = mapItem(raw);
    if (!mapped || !mapped.text) continue;

    const embedding = await getEmbedding(mapped.text.slice(0, 2000));
    const match = findBestMythMatch(embedding, myths);
    if (!match || match.similarity < MATCH_CONFIDENCE_THRESHOLD) continue;
    matched++;

    const priority = computePriorityScore({
      views: mapped.views,
      likes: mapped.likes,
      comments: mapped.comments,
      shares: mapped.shares,
      postedAt: mapped.postedAt,
      matchConfidence: match.similarity,
    });
    if (priority === 0) continue;

    const ok = await upsertCandidate(admin, {
      platform,
      external_id: mapped.externalId,
      url: mapped.url,
      creator: mapped.creator,
      title: mapped.text.slice(0, 120),
      excerpt: mapped.text.slice(0, 280),
      thumbnail_url: mapped.thumbnailUrl,
      views: mapped.views,
      likes: mapped.likes,
      comments: mapped.comments,
      shares: mapped.shares,
      posted_at: mapped.postedAt,
      myth_id: match.mythId,
      match_confidence: match.similarity,
      reach_score: computeReachScore(mapped.views),
      priority_score: priority,
    });
    if (ok) inserted++;
  }
  return { inserted, matched, totalItems, sampleKeys };
}

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
  const platformStats: Record<string, { totalItems: number; matched: number; inserted: number; sampleKeys?: string[] }> = {};

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

  if (process.env.APIFY_TOKEN) {
    try {
      const r = await ingestApifyPlatform({
        admin, myths, platform: "tiktok",
        actorId: process.env.APIFY_TIKTOK_ACTOR_ID || "clockworks/tiktok-scraper",
        input: { hashtags: HASHTAGS, resultsPerPage: 15 },
        mapItem: (item) => ({
          text: item.text ?? item.desc ?? "",
          views: Number(item.playCount ?? item.views ?? 0),
          likes: Number(item.diggCount ?? item.likes ?? 0),
          comments: Number(item.commentCount ?? item.comments ?? 0),
          shares: Number(item.shareCount ?? item.shares ?? 0),
          postedAt: item.createTimeISO ?? new Date().toISOString(),
          externalId: String(item.id ?? item.webVideoUrl ?? ""),
          url: item.webVideoUrl ?? item.url ?? "",
          creator: item.authorMeta?.name ?? item.author ?? "unbekannt",
          thumbnailUrl: item.covers?.default ?? item.videoMeta?.coverUrl,
        }),
      });
      inserted += r.inserted;
      platformStats.tiktok = r;
    } catch (e: any) {
      errors.push(`tiktok: ${e.message}`);
    }

    try {
      const r = await ingestApifyPlatform({
        admin, myths, platform: "instagram",
        actorId: process.env.APIFY_INSTAGRAM_ACTOR_ID || "apify/instagram-hashtag-scraper",
        input: { hashtags: HASHTAGS, resultsLimit: 15 },
        mapItem: (item) => ({
          text: item.caption ?? "",
          views: Number(item.videoViewCount ?? item.videoPlayCount ?? 0),
          likes: Number(item.likesCount ?? 0),
          comments: Number(item.commentsCount ?? 0),
          shares: 0,
          postedAt: item.timestamp ?? new Date().toISOString(),
          externalId: String(item.id ?? item.shortCode ?? ""),
          url: item.url ?? "",
          creator: item.ownerUsername ?? "unbekannt",
          thumbnailUrl: item.displayUrl,
        }),
      });
      inserted += r.inserted;
      platformStats.instagram = r;
    } catch (e: any) {
      errors.push(`instagram: ${e.message}`);
    }

    try {
      const r = await ingestApifyPlatform({
        admin, myths, platform: "x",
        actorId: process.env.APIFY_X_ACTOR_ID || "apidojo/tweet-scraper",
        input: {
          searchTerms: SEARCH_QUERIES,
          maxItems: 15,
          lang: "de",
        },
        mapItem: (item) => ({
          text: item.text ?? item.fullText ?? "",
          views: Number(item.viewCount ?? item.views ?? 0),
          likes: Number(item.likeCount ?? item.likes ?? 0),
          comments: Number(item.replyCount ?? item.comments ?? 0),
          shares: Number(item.retweetCount ?? item.shares ?? 0),
          postedAt: item.createdAt ?? new Date().toISOString(),
          externalId: String(item.id ?? item.tweetId ?? item.url ?? ""),
          url: item.url ?? item.twitterUrl ?? "",
          creator: item.author?.userName ?? item.authorUsername ?? "unbekannt",
          thumbnailUrl: item.author?.profilePicture,
        }),
      });
      inserted += r.inserted;
      platformStats.x = r;
    } catch (e: any) {
      errors.push(`x: ${e.message}`);
    }

    try {
      const r = await ingestApifyPlatform({
        admin, myths, platform: "linkedin",
        actorId: process.env.APIFY_LINKEDIN_ACTOR_ID || "harvestapi/linkedin-post-search",
        input: {
          searchQueries: SEARCH_QUERIES,
          maxItems: 15,
        },
        mapItem: (item) => ({
          text: item.text ?? item.content ?? item.commentary ?? "",
          views: Number(item.viewsCount ?? 0),
          likes: Number(item.likesCount ?? item.reactionsCount ?? 0),
          comments: Number(item.commentsCount ?? 0),
          shares: Number(item.sharesCount ?? item.repostsCount ?? 0),
          postedAt: item.postedAt ?? item.publishedAt ?? new Date().toISOString(),
          externalId: String(item.id ?? item.postId ?? item.url ?? ""),
          url: item.url ?? item.postUrl ?? "",
          creator: item.author?.name ?? item.authorName ?? "unbekannt",
          thumbnailUrl: item.author?.profilePicture,
        }),
      });
      inserted += r.inserted;
      platformStats.linkedin = r;
    } catch (e: any) {
      errors.push(`linkedin: ${e.message}`);
    }
  } else {
    errors.push("APIFY_TOKEN fehlt - TikTok/Instagram/X/LinkedIn uebersprungen");
  }

  return withCORS(NextResponse.json({ ok: true, inserted, errors, platformStats }));
}
