"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.average = exports.scoreToTier = exports.tierToScore = void 0;
const MAX_TIER = 9;
const tierToScore = (tier) => {
    const normalized = Math.max(0, Math.min(MAX_TIER, tier));
    return 100 - normalized * 10;
};
exports.tierToScore = tierToScore;
const scoreToTier = (score) => {
    const clamped = Math.max(10, Math.min(100, score));
    return Math.max(0, Math.min(MAX_TIER, Math.round((100 - clamped) / 10)));
};
exports.scoreToTier = scoreToTier;
const average = (values) => {
    if (!values.length) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};
exports.average = average;
