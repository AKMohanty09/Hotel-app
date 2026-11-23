import type { RestaurantReview } from '../types/domain';

export interface ReviewSummaryMetrics {
  totalCount: number;
  avgOverall: number;
  avgFood: number;
  avgService: number;
  repliedCount: number;
  responseRatePercent: number;
  distribution: { stars: number; count: number; percent: number }[];
}

export function clampRating(value: unknown, fallback = 5): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(5, Math.max(1, Math.round(num)));
}

export function computeReviewMetrics(reviews: RestaurantReview[]): ReviewSummaryMetrics {
  const list = Array.isArray(reviews) ? reviews : [];
  const totalCount = list.length;

  if (totalCount === 0) {
    return {
      totalCount: 0,
      avgOverall: 0,
      avgFood: 0,
      avgService: 0,
      repliedCount: 0,
      responseRatePercent: 0,
      distribution: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0, percent: 0 })),
    };
  }

  let overallSum = 0;
  let foodSum = 0;
  let serviceSum = 0;
  let repliedCount = 0;
  const counts = new Map<number, number>([
    [5, 0],
    [4, 0],
    [3, 0],
    [2, 0],
    [1, 0],
  ]);

  for (const rev of list) {
    const overall = clampRating(rev.overallRating, 5);
    overallSum += overall;
    foodSum += clampRating(rev.foodRating, overall);
    serviceSum += clampRating(rev.serviceRating, overall);
    if (rev.managerReply && rev.managerReply.trim().length > 0) {
      repliedCount += 1;
    }
    counts.set(overall, (counts.get(overall) || 0) + 1);
  }

  const distribution = [5, 4, 3, 2, 1].map((stars) => {
    const count = counts.get(stars) || 0;
    return {
      stars,
      count,
      percent: Math.round((count / totalCount) * 100),
    };
  });

  return {
    totalCount,
    avgOverall: Number((overallSum / totalCount).toFixed(1)),
    avgFood: Number((foodSum / totalCount).toFixed(1)),
    avgService: Number((serviceSum / totalCount).toFixed(1)),
    repliedCount,
    responseRatePercent: Math.round((repliedCount / totalCount) * 100),
    distribution,
  };
}

export function sortReviewsNewestFirst(reviews: RestaurantReview[]): RestaurantReview[] {
  return [...(reviews || [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
