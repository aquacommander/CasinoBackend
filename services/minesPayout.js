// backend/services/minesPayout.js
const HOUSE_EDGE = Number(process.env.HOUSE_EDGE ?? 0.025);

function combination(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - (k - i))) / i;
  }
  return result;
}

function calculateMinesPayout({ mines, revealedGems, betAmount }) {
  const totalSlots = 25;
  const safeSlots = totalSlots - mines;

  if (!Number.isInteger(revealedGems) || revealedGems < 1) {
    // Disallow "instant cashout" (it would pay < bet after house edge)
    return { payoutAmount: 0, multiplier: 0, trueMultiplier: 0, houseEdge: HOUSE_EDGE };
  }

  const totalComb = combination(totalSlots, revealedGems);
  const safeComb = combination(safeSlots, revealedGems);
  const trueMultiplier = totalComb / safeComb;      // > 1
  const multiplier = trueMultiplier * (1 - HOUSE_EDGE);

  const payoutAmount = Math.floor(betAmount * multiplier);

  return {
    payoutAmount,
    multiplier,
    trueMultiplier,
    houseEdge: HOUSE_EDGE,
  };
}

module.exports = { calculateMinesPayout };
