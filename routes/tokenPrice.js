const express = require('express');
const router = express.Router();
const axios = require('axios');

let cachedPrice = {
  price: 1, // Default: 1 QDoge = 1 QUBIC
  timestamp: Date.now()
};
const CACHE_DURATION = 30000; // 30 seconds

/**
 * GET /api/token-price/qdoge
 * Get QDoge token price in QUBIC
 */
router.get('/qdoge', async (req, res) => {
  try {
    const now = Date.now();

    // Return cached price if still valid
    if (cachedPrice && (now - cachedPrice.timestamp) < CACHE_DURATION) {
      return res.json({
        price: cachedPrice.price,
        timestamp: cachedPrice.timestamp
      });
    }

    // TODO: Implement actual QDoge price fetching
    // Option 1: Query QUBIC DEX/Exchange API
    // Option 2: Use price oracle
    // Option 3: Calculate from liquidity pools
    
    // Placeholder: You can set a fixed price or fetch from an API
    // Example:
    // try {
    //   const response = await axios.get(process.env.QDOGE_PRICE_ORACLE_URL);
    //   cachedPrice = {
    //     price: response.data.price || 1,
    //     timestamp: now
    //   };
    // } catch (error) {
    //   console.error('Failed to fetch QDoge price:', error);
    //   // Use cached price or default
    // }

    // For now, use default price (you can update this)
    cachedPrice = {
      price: 1, // Update this with actual price fetching logic
      timestamp: now
    };

    res.json({
      price: cachedPrice.price,
      timestamp: cachedPrice.timestamp
    });
  } catch (error) {
    console.error('Error fetching QDoge price:', error);
    res.status(500).json({
      error: 'Failed to fetch token price',
      message: error.message
    });
  }
});

module.exports = router;
