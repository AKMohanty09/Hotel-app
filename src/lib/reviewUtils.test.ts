import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRating, computeReviewMetrics, sortReviewsNewestFirst } from './reviewUtils';
import type { RestaurantReview } from '../types/domain';

test('clampRating normalizes bounds and invalid numbers', () => {
  assert.equal(clampRating(0), 1);
  assert.equal(clampRating(7), 5);
  assert.equal(clampRating(4.6), 5);
  assert.equal(clampRating(3.2), 3);
  assert.equal(clampRating(Number.NaN, 4), 4);
});

test('computeReviewMetrics handles empty list cleanly', () => {
  const metrics = computeReviewMetrics([]);
  assert.equal(metrics.totalCount, 0);
  assert.equal(metrics.avgOverall, 0);
  assert.equal(metrics.avgFood, 0);
  assert.equal(metrics.avgService, 0);
  assert.equal(metrics.responseRatePercent, 0);
  assert.equal(metrics.distribution.length, 5);
});

test('computeReviewMetrics calculates averages, distribution, and response rate', () => {
  const sample: RestaurantReview[] = [
    {
      id: 'rev_1',
      sessionId: 'ses_1',
      tableNumber: 'T-01',
      customerName: 'Ananya',
      overallRating: 5,
      foodRating: 5,
      serviceRating: 4,
      comment: 'Wood-fired pizza was crisp and delicious!',
      managerReply: 'Thank you Ananya!',
      repliedBy: 'Owner',
      repliedAt: '2026-11-23T02:00:00Z',
      createdAt: '2026-11-23T01:00:00Z',
    },
    {
      id: 'rev_2',
      sessionId: 'ses_2',
      tableNumber: 'T-03',
      overallRating: 3,
      foodRating: 4,
      serviceRating: 2,
      comment: 'Food was great, service took a few extra minutes.',
      createdAt: '2026-11-23T02:00:00Z',
    },
  ];

  const metrics = computeReviewMetrics(sample);
  assert.equal(metrics.totalCount, 2);
  assert.equal(metrics.avgOverall, 4);
  assert.equal(metrics.avgFood, 4.5);
  assert.equal(metrics.avgService, 3);
  assert.equal(metrics.repliedCount, 1);
  assert.equal(metrics.responseRatePercent, 50);
  assert.equal(metrics.distribution[0].stars, 5);
  assert.equal(metrics.distribution[0].count, 1);
  assert.equal(metrics.distribution[0].percent, 50);
  assert.equal(metrics.distribution[2].stars, 3);
  assert.equal(metrics.distribution[2].count, 1);
});

test('sortReviewsNewestFirst orders descending by createdAt', () => {
  const sorted = sortReviewsNewestFirst([
    {
      id: 'old',
      tableNumber: 'T-01',
      overallRating: 4,
      foodRating: 4,
      serviceRating: 4,
      createdAt: '2026-11-22T10:00:00Z',
    },
    {
      id: 'new',
      tableNumber: 'T-02',
      overallRating: 5,
      foodRating: 5,
      serviceRating: 5,
      createdAt: '2026-11-23T10:00:00Z',
    },
  ]);
  assert.equal(sorted[0].id, 'new');
  assert.equal(sorted[1].id, 'old');
});
