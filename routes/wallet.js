const express = require('express');
const router = express.Router();
const { getQubicBalance } = require('../utils/qubicBalance');
const { isValidQubicPublicId, normalizeQubicPublicId } = require('../utils/validation');

/**
 * GET /api/wallet/balance/:publicId
 * Get wallet balance (QUBIC and QDoge)
 * @param {string} publicId - Qubic public ID (identity), must be 60 uppercase A-Z characters
 */
router.get('/balance/:publicId', async (req, res) => {
  try {
    let publicId = normalizeQubicPublicId(req.params.publicId);

    if (!isValidQubicPublicId(publicId)) {
      return res.status(400).json({
        error: 'Invalid Qubic publicId (identity). It must be exactly 60 A–Z characters.'
      });
    }

    const balances = await getQubicBalance(publicId);

    res.json({
      qubic: balances.qubic,
      qdoge: balances.qdoge
    });
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({
      error: 'Failed to fetch wallet balance',
      message: error.message
    });
  }
});

module.exports = router;
