const MAX_TIER = 9;

export const tierToScore = (tier: number): number => {
  const normalized = Math.max(0, Math.min(MAX_TIER, tier));
  return 100 - normalized * 10;
};

export const scoreToTier = (score: number): number => {
  const clamped = Math.max(10, Math.min(100, score));
  return Math.max(0, Math.min(MAX_TIER, Math.round((100 - clamped) / 10)));
};

export const average = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
