/**
 * Validation utilities for Qubic addresses
 * 
 * Qubic uses:
 * - Seed (private): 55 lowercase letters (a-z)
 * - PublicId/Identity (public): 60 uppercase letters (A-Z)
 */

/**
 * Validate Qubic PublicId (Identity)
 * PublicIds are 60 uppercase A-Z characters
 * @param {string} publicId - Qubic public ID to validate
 * @returns {boolean} - True if valid
 */
function isValidQubicPublicId(publicId) {
  if (!publicId || typeof publicId !== 'string') {
    return false;
  }
  // Must be exactly 60 uppercase A-Z characters
  return /^[A-Z]{60}$/.test(publicId.trim());
}

/**
 * Normalize Qubic PublicId (trim and uppercase)
 * @param {string} publicId - Qubic public ID to normalize
 * @returns {string} - Normalized public ID
 */
function normalizeQubicPublicId(publicId) {
  if (!publicId) return '';
  return publicId.trim().toUpperCase();
}

/**
 * Validate Qubic Seed (Private Key)
 * Seeds are 55 lowercase letters (a-z)
 * @param {string} seed - Qubic seed to validate
 * @returns {boolean} - True if valid
 */
function isValidQubicSeed(seed) {
  if (!seed || typeof seed !== 'string') {
    return false;
  }
  // Must be exactly 55 lowercase a-z characters
  return /^[a-z]{55}$/.test(seed.trim());
}

module.exports = {
  isValidQubicPublicId,
  normalizeQubicPublicId,
  isValidQubicSeed
};
