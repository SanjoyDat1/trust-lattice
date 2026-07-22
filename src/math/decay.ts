/** Exponential half-life decay weight. */

export function decayWeight(ageHours: number, halfLifeHours: number): number {
  if (halfLifeHours <= 0) {
    return 0;
  }
  if (ageHours <= 0) {
    return 1;
  }
  return Math.pow(2, -ageHours / halfLifeHours);
}

export function ageHours(createdAt: string, now: Date = new Date()): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) {
    return 0;
  }
  return Math.max(0, (now.getTime() - created) / 3_600_000);
}
