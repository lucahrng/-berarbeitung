import { computePriorityScore, computeReachScore, MATCH_CONFIDENCE_THRESHOLD } from "@/lib/scoring";
import { getEmbedding, cosineSimilarity, parseEmbedding } from "@/lib/embeddings";
import { runApifyActor } from "@/lib/apify";

export type MythRow = {
  id: string;
  claim: string;
  embedding: unknown;
};

export function findBestMythMatch(itemEmbedding: number[], myths: MythRow[]) {
  let best: { mythId: string; similarity: number } | null = null;
  for (const myth of myths) {
    const emb = parseEmbedding(myth.embedding);
    if (!emb) continue;
    const sim = cosineSimilarity(itemEmbedding, emb);
    if (!best || sim > best.similarity) best = { mythId: myth.id, similarity: sim };
  }
  return best;
}

export async function upsertCandidate(admin: any, row: Record<string, unknown>) {
  const { error } = await admin
    .from("candidates")
    .upsert(row, { onConflict: "platform,external_id" });
  return !error;
}

export async function ingestApifyPlatform(opts: {
  admin: any;
  myths: MythRow[];
  platform: string;
  actorId: string;
  input: Record<string, unknown>;
  maxItemsToProcess?: number;
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
  const { admin, myths, platform, actorId, input, mapItem, maxItemsToProcess = 12 } = opts;
  let inserted = 0;
  let matched = 0;
  const rawItems: any[] = await runApifyActor(actorId, input);
  const totalItems = rawItems?.length ?? 0;
  const sampleKeys = totalItems > 0 ? Object.keys(rawItems[0]) : [];
  const items = rawItems.slice(0, maxItemsToProcess);

  const mappedItems = items.map((raw) => mapItem(raw)).filter((m): m is NonNullable<typeof m> => !!m && !!m.text);

  const embeddings = await Promise.all(mappedItems.map((m) => getEmbedding(m.text.slice(0, 2000))));

  for (let i = 0; i < mappedItems.length; i++) {
    const mapped = mappedItems[i];
    const embedding = embeddings[i];

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

export const HASHTAGS = ["ernaehrungsmythen", "abnehmen", "ernaehrung", "fitnessmythen", "gesundheit"];

export const SEARCH_QUERIES = [
  "Honig macht nicht dick",
  "Datteln kein Zucker",
  "Frühstück wichtigste Mahlzeit",
  "Süßstoffe ungesund krebserregend",
  "Kohlenhydrate abends dick",
];

export const PLATFORM_CONFIGS: Record<
  string,
  {
    actorEnvVar: string;
    defaultActorId: string;
    buildInput: () => Record<string, unknown>;
    mapItem: (item: any) => ReturnType<typeof identityMapItem>;
  }
> = {
  tiktok: {
    actorEnvVar: "APIFY_TIKTOK_ACTOR_ID",
    defaultActorId: "clockworks/tiktok-scraper",
    buildInput: () => ({ hashtags: HASHTAGS, resultsPerPage: 8 }),
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
  },
  instagram: {
    actorEnvVar: "APIFY_INSTAGRAM_ACTOR_ID",
    defaultActorId: "apify/instagram-hashtag-scraper",
    buildInput: () => ({ hashtags: HASHTAGS, resultsLimit: 8 }),
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
  },
  x: {
    actorEnvVar: "APIFY_X_ACTOR_ID",
    defaultActorId: "apidojo/tweet-scraper",
    buildInput: () => ({ searchTerms: HASHTAGS.map((h) => `#${h}`), maxItems: 15, lang: "de" }),
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
  },
  linkedin: {
    actorEnvVar: "APIFY_LINKEDIN_ACTOR_ID",
    defaultActorId: "harvestapi/linkedin-post-search",
    buildInput: () => ({ searchQueries: SEARCH_QUERIES.slice(0, 2), maxItems: 5 }),
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
  },
};

function identityMapItem(item: any) {
  return item as {
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
  };
}
