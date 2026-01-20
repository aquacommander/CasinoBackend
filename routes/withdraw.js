const express = require('express');
const router = express.Router();
const { getQubicBalance, updateWalletBalance } = require('../utils/qubicBalance');
const { isValidQubicPublicId, normalizeQubicPublicId } = require('../utils/validation');

const TRANSACTION_FEE = 100; // QUBIC
const MIN_WITHDRAWAL = 1000; // QUBIC

/**
 * POST /api/withdraw
 * Process withdrawal request
 * 
 * Body: {
 *   publicKey: string (Qubic publicId, 60 uppercase A-Z characters),
 *   amount: number (in QUBIC),
 *   tokenType: 'QUBIC' | 'QDoge'
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { publicKey, amount, tokenType } = req.body;
    const publicId = normalizeQubicPublicId(publicKey);

    // Validation
    if (!isValidQubicPublicId(publicId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Qubic publicId (identity). It must be exactly 60 A–Z characters.'
      });
    }

    if (!amount || amount < MIN_WITHDRAWAL) {
      return res.status(400).json({
        success: false,
        error: `Minimum withdrawal is ${MIN_WITHDRAWAL} QUBIC`
      });
    }

    if (!tokenType || !['QUBIC', 'QDoge'].includes(tokenType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token type. Must be QUBIC or QDoge'
      });
    }

    // Get current balance
    const balances = await getQubicBalance(publicId);

    // Validate balance
    if (balances.qubic < TRANSACTION_FEE) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. You need ${TRANSACTION_FEE} QUBIC for transaction fee`
      });
    }

    if (tokenType === 'QUBIC') {
      if (balances.qubic < amount + TRANSACTION_FEE) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient QUBIC balance'
        });
      }
    } else if (tokenType === 'QDoge') {
      if (balances.qdoge < amount) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient QDoge balance'
        });
      }
      if (balances.qubic < TRANSACTION_FEE) {
        return res.status(400).json({
          success: false,
          error: `You need ${TRANSACTION_FEE} QUBIC for transaction fee`
        });
      }
    }

    // TODO: Implement actual blockchain transaction
    // This is where you would:
    // 1. Create QUBIC transaction
    // 2. Sign transaction (if you have private key access)
    // 3. Broadcast transaction to QUBIC network
    // 4. Get transaction hash
    
    // Placeholder transaction hash
    const txHash = `0x${Buffer.from(`${publicId}${Date.now()}`).toString('hex').slice(0, 64)}`;

    // Update balances in database (deduct amount + fee)
    if (tokenType === 'QUBIC') {
      await updateWalletBalance(
        publicId,
        balances.qubic - amount - TRANSACTION_FEE,
        balances.qdoge
      );
    } else {
      await updateWalletBalance(
        publicId,
        balances.qubic - TRANSACTION_FEE,
        balances.qdoge - amount
      );
    }

    res.json({
      success: true,
      txHash,
      message: 'Withdrawal processed successfully'
    });
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process withdrawal',
      message: error.message
    });
  }
});

module.exports = router;
