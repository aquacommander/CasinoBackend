/**
 * QUBIC Balance Fetcher
 * 
 * Fetches balance from QUBIC blockchain using Qubic RPC API
 * Documentation: https://qubic.github.io/integration/Partners/swagger/qubic-rpc-doc.html
 */

const { query } = require('../database/connection');
const axios = require('axios');
const { isValidQubicPublicId, normalizeQubicPublicId } = require('./validation');

// Qubic RPC endpoints
const QUBIC_RPC_URL_RAW = process.env.QUBIC_RPC_URL || 'https://rpc.qubic.org';

function normalizeRpcBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

const QUBIC_RPC_BASE = normalizeRpcBase(QUBIC_RPC_URL_RAW);
const QDoge_ASSET_NAME = 'QDoge'; // QDoge asset name

/**
 * Convert balance string to integer
 * The Qubic RPC API returns balance as a string in QU (Qubic Units)
 * @param {number|string} balanceAmount - Balance as string or number
 * @returns {number} - Balance in QU (integer)
 */
function convertBalanceToInteger(balanceAmount) {
  if (!balanceAmount && balanceAmount !== 0) return 0;
  // The API returns balance directly in QU, not in qubic units
  // So we just need to parse it as an integer
  return Math.floor(Number(balanceAmount) || 0);
}

/**
 * Fetch QUBIC balance from RPC API
 * 
 * @param {string} publicId - Qubic public ID (identity), must be 60 uppercase A-Z characters
 * @returns {Promise<{qubic: number, qdoge: number}>}
 */
async function getQubicBalance(publicId) {
  try {
    // Normalize and validate publicId
    publicId = normalizeQubicPublicId(publicId);
    
    if (!isValidQubicPublicId(publicId)) {
      console.error('Invalid Qubic publicId format. Must be 60 uppercase A-Z characters.');
      return { qubic: 0, qdoge: 0 };
    }

    // Fetch QUBIC (QU) balance from RPC API
    // Endpoint: GET /v1/balances/{identityId}
    // The identityId is the 60-character Qubic public ID (identity)
    const balanceUrl = `${QUBIC_RPC_BASE}/v1/balances/${publicId}`;
    
    console.log(`Fetching balance for ${publicId} from ${balanceUrl}`);
    
    let qubicBalance = 0;
    let qdogeBalance = 0;

    try {
      // Get QU balance
      const balanceResponse = await axios.get(balanceUrl, {
        timeout: 10000, // 10 second timeout
        headers: {
          'Accept': 'application/json'
        }
      });

      // Response format: { balance: { balance: "5000", incomingAmount: "5000", outgoingAmount: "0", ... } }
      const responseData = balanceResponse.data;
      let balanceObj = null;
      
      if (responseData && responseData.balance) {
        balanceObj = responseData.balance;
      } else if (responseData && (responseData.incomingAmount !== undefined || responseData.balance !== undefined)) {
        balanceObj = responseData;
      }
      
      if (balanceObj) {
        // The API returns balance directly in QU (not in qubic units)
        // Use the 'balance' field directly, or calculate from incomingAmount - outgoingAmount
        if (balanceObj.balance !== undefined) {
          qubicBalance = convertBalanceToInteger(balanceObj.balance);
        } else {
          // Calculate net balance (incoming - outgoing)
          const incomingAmount = convertBalanceToInteger(balanceObj.incomingAmount || 0);
          const outgoingAmount = convertBalanceToInteger(balanceObj.outgoingAmount || 0);
          qubicBalance = Math.max(0, incomingAmount - outgoingAmount);
        }
        
        console.log(`QU Balance for ${publicId}: ${qubicBalance} QU`);
      } else {
        console.warn('Unexpected balance response format:', JSON.stringify(responseData, null, 2));
      }
    } catch (balanceError) {
      console.error('Error fetching QU balance from RPC:', balanceError.message);
      if (balanceError.response) {
        console.error('Response status:', balanceError.response.status);
        console.error('Response data:', balanceError.response.data);
      }
    }

    // Fetch QDoge balance from assets endpoint
    // Endpoint: GET /v1/assets/{identity}/owned
    try {
      const assetsUrl = `${QUBIC_RPC_BASE}/v1/assets/${publicId}/owned`;
      const assetsResponse = await axios.get(assetsUrl, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json'
        }
      });

      if (assetsResponse.data && Array.isArray(assetsResponse.data)) {
        // Find QDoge asset in the list
        const qdogeAsset = assetsResponse.data.find(asset => {
          // Asset name might be in different formats
          const assetName = asset.assetName || asset.name || '';
          return assetName.toString().includes('QDoge') || 
                 assetName.toString().includes('QD') ||
                 // QDoge asset name as number (might need conversion)
                 asset.assetName === getAssetNameAsNumber('QDoge');
        });

        if (qdogeAsset) {
          // QDoge balance is typically in the numberOfShares field
          qdogeBalance = Math.floor(Number(qdogeAsset.numberOfShares || 0));
          console.log(`QDoge Balance for ${publicId}: ${qdogeBalance}`);
        } else {
          console.log(`No QDoge asset found for ${publicId}`);
        }
      }
    } catch (assetsError) {
      console.error('Error fetching assets from RPC:', assetsError.message);
      // QDoge is optional, don't fail if assets endpoint fails
    }

    // Update database cache for faster subsequent queries
    try {
      await updateWalletBalance(publicId, qubicBalance, qdogeBalance);
    } catch (dbError) {
      console.error('Error updating database cache:', dbError.message);
      // Don't fail if database update fails
    }

    return {
      qubic: qubicBalance,
      qdoge: qdogeBalance
    };

  } catch (error) {
    console.error('Error fetching QUBIC balance:', error);
    
    // Fallback to database cache if RPC fails
    try {
      const results = await query(
        'SELECT qubic_balance, qdoge_balance FROM wallets WHERE public_key = ?',
        [publicId]
      );
      
      if (results.length > 0) {
        console.log('Using cached balance from database');
        return {
          qubic: results[0].qubic_balance || 0,
          qdoge: results[0].qdoge_balance || 0
        };
      }
    } catch (dbError) {
      console.error('Database fallback also failed:', dbError.message);
    }
    
    // Last resort: return 0
    return { qubic: 0, qdoge: 0 };
  }
}

/**
 * Convert asset name string to uint64 number
 * Qubic assets use uint64 representation of asset names
 * @param {string} assetName - Asset name (e.g., "QDoge")
 * @returns {BigInt} - Asset name as uint64 number
 */
function getAssetNameAsNumber(assetName) {
  // Convert string to uint64 (same logic as in QX examples)
  const encoder = new TextEncoder();
  const padded = assetName.padEnd(8, '\0');
  const bytes = encoder.encode(padded);
  const view = new DataView(bytes.buffer);
  return view.getBigUint64(0, true); // little endian
}

/**
 * Update wallet balance in database
 * Use this when you process transactions
 * @param {string} publicId - Qubic public ID (identity), 60 uppercase A-Z characters
 */
async function updateWalletBalance(publicId, qubicBalance, qdogeBalance) {
  try {
    // Normalize publicId before storing
    publicId = normalizeQubicPublicId(publicId);
    
    await query(
      `INSERT INTO wallets (public_key, qubic_balance, qdoge_balance, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
       qubic_balance = VALUES(qubic_balance),
       qdoge_balance = VALUES(qdoge_balance),
       updated_at = NOW()`,
      [publicId, Math.floor(qubicBalance), Math.floor(qdogeBalance)]
    );
  } catch (error) {
    console.error('Error updating wallet balance:', error);
    throw error;
  }
}

module.exports = {
  getQubicBalance,
  updateWalletBalance
};
