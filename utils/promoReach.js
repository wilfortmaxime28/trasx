function isNewUserWithinWindow(userCreatedAt, promoWindowDays) {
  const createdAtMs = new Date(userCreatedAt || 0).getTime();
  if (!createdAtMs || !Number.isFinite(createdAtMs)) return false;
  const safeDays = Math.max(1, Number(promoWindowDays || 0));
  return (Date.now() - createdAtMs) <= (safeDays * 24 * 60 * 60 * 1000);
}

function computePromoDailyTarget({
  isEligibleNewUser,
  baseDailyViews,
  paidHashtagCount = 0,
  paidHashtagViewBonus = 0,
  paidBackgroundPrice = 0,
  paidBackgroundViewBonusPerDollar = 0
}) {
  if (!isEligibleNewUser) return 0;

  const base = Math.max(0, Number(baseDailyViews || 0));
  const hashtagBonus = Math.max(0, Number(paidHashtagCount || 0)) * Math.max(0, Number(paidHashtagViewBonus || 0));
  const backgroundBonus = Math.round(Math.max(0, Number(paidBackgroundPrice || 0)) * Math.max(0, Number(paidBackgroundViewBonusPerDollar || 0)));

  return Math.max(0, Math.round(base + hashtagBonus + backgroundBonus));
}

module.exports = {
  isNewUserWithinWindow,
  computePromoDailyTarget
};
