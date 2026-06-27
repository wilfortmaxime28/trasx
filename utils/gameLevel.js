const LEVEL_TITLES = [
  { min: 40, title: 'Mythique' },
  { min: 30, title: 'Legende' },
  { min: 20, title: 'Maitre' },
  { min: 15, title: 'Elite' },
  { min: 10, title: 'Or' },
  { min: 6, title: 'Argent' },
  { min: 3, title: 'Bronze' },
  { min: 1, title: 'Debutant' }
];

function toSafeInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getLevelTitle(level) {
  const safeLevel = Math.max(1, toSafeInt(level));
  const tier = LEVEL_TITLES.find((entry) => safeLevel >= entry.min);
  return tier ? tier.title : 'Debutant';
}

function calculateGameLevel(matchesPlayed, matchesWon) {
  const normalizedPlayed = Math.max(toSafeInt(matchesPlayed), toSafeInt(matchesWon));
  const normalizedWon = Math.min(normalizedPlayed, toSafeInt(matchesWon));
  const winRate = normalizedPlayed > 0
    ? Math.round((normalizedWon / normalizedPlayed) * 100)
    : 0;
  const experience = (normalizedPlayed * 12) + (normalizedWon * 30) + Math.round(winRate / 4);
  const level = Math.max(1, Math.floor(Math.sqrt(experience / 20)) + 1);

  return {
    matchesPlayed: normalizedPlayed,
    matchesWon: normalizedWon,
    winRate,
    experience,
    level,
    levelTitle: getLevelTitle(level)
  };
}

function attachUserGameStats(user) {
  if (!user || typeof user !== 'object') return user;
  const computed = calculateGameLevel(
    user.game_matches_played ?? user.matchesPlayed,
    user.game_matches_won ?? user.matchesWon
  );

  return {
    ...user,
    ...computed
  };
}

function attachBotGameStats(bot) {
  if (!bot || typeof bot !== 'object') return bot;
  const computed = calculateGameLevel(
    bot.matches_played ?? bot.matchesPlayed,
    bot.wins ?? bot.matchesWon
  );

  return {
    ...bot,
    ...computed,
    wins: computed.matchesWon
  };
}

module.exports = {
  calculateGameLevel,
  getLevelTitle,
  attachUserGameStats,
  attachBotGameStats
};
