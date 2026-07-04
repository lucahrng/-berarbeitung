export type CandidateInput = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  postedAt: string;
  matchConfidence: number;
};

export function computeReachScore(views: number) {
  return Math.min(100, Math.round((Math.log10(views + 1) / 7.5) * 100));
}

export function computeEngagementRate(v: CandidateInput) {
  const engagement = v.likes + v.comments * 2 + v.shares * 3;
  return v.views > 0 ? engagement / v.views : 0;
}

export function computeRecencyBoost(postedAt: string) {
  const hoursAgo = (Date.now() - new Date(postedAt).getTime()) / 3_600_000;
  return Math.max(0, 1 - hoursAgo / 96);
}

export const MATCH_CONFIDENCE_THRESHOLD = 0.55;

export function computePriorityScore(v: CandidateInput) {
  if (v.matchConfidence < MATCH_CONFIDENCE_THRESHOLD) return 0;
  const reach = computeReachScore(v.views);
  const engagement = computeEngagementRate(v) * 1500;
  const recency = computeRecencyBoost(v.postedAt) * 20;
  const confidenceMultiplier = 0.6 + v.matchConfidence * 0.4;
  const raw = reach * 0.55 + engagement * 0.25 + recency * 0.2;
  return Math.min(100, Math.round(raw * confidenceMultiplier));
}
