const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { getPool } = require('./database/connection');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

/**
 * CORS
 * - For Railway/Vercel, set ALLOWED_ORIGINS to your Vercel domain(s), comma-separated.
 *   Example:
 *   ALLOWED_ORIGINS=https://yourapp.vercel.app,https://your-custom-domain.com
 */
const allowedOrigins =
  process.env.ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) || ['http://localhost:3000', 'http://localhost:3002'];

const allowedOriginRegex = process.env.ALLOWED_ORIGIN_REGEX
  ? new RegExp(process.env.ALLOWED_ORIGIN_REGEX)
  : null;

const isOriginAllowed = (origin) => {
  if (!origin) return true; // allow same-origin / server-to-server
  if (allowedOrigins.includes(origin)) return true;
  if (allowedOriginRegex && allowedOriginRegex.test(origin)) return true;
  return false;
};

/**
 * Socket.io setup with CORS
 */
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

/**
 * Middleware
 */
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);

// IMPORTANT: parse JSON body - must be before routes
app.use(express.json({ limit: '1mb' }));

// Request logging middleware (for debugging)
app.use((req, res, next) => {
  try {
    const bodyPreview =
      req.body ? JSON.stringify(req.body).substring(0, 100) : '';
    console.log('REQ:', req.method, req.originalUrl, bodyPreview);
  } catch {
    console.log('REQ:', req.method, req.originalUrl, '(body not serializable)');
  }
  next();
});

/**
 * MySQL connection (initialized on first use)
 */
getPool();

/**
 * Import routes
 */
console.log('Loading routes...');
const walletRoutes = require('./routes/wallet');
const tokenPriceRoutes = require('./routes/tokenPrice');
const withdrawRoutes = require('./routes/withdraw');
const mineRoutes = require('./routes/mine');
const videoPokerRoutes = require('./routes/videoPoker');
const txRoutes = require('./routes/tx');
const usersRoutes = require('./routes/users');
console.log('✅ All routes loaded');

/**
 * API Routes
 */
app.use('/api/wallet', walletRoutes);
app.use('/api/token-price', tokenPriceRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/mine', mineRoutes);
app.use('/api/video-poker', videoPokerRoutes);
app.use('/api/tx', txRoutes);
app.use('/api/users', usersRoutes);

// Log registered routes on startup
console.log('📋 Registered API routes:');
console.log('  - GET  /health');
console.log('  - POST /api/mine/status');
console.log('  - POST /api/mine/create');
console.log('  - POST /api/mine/pick');
console.log('  - POST /api/mine/reveal');
console.log('  - POST /api/mine/cashout');
console.log('  - POST /api/mine/claim');
console.log('  - GET  /api/mine/test');

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 404 handler - must be after all routes, before error handler
 */
app.use((req, res) => {
  console.log('404:', req.method, req.originalUrl);
  res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl,
    method: req.method,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

/**
 * Global error handler - must be after all routes
 */
app.use((err, req, res, next) => {
  console.error('API ERROR:', err);
  if (err?.stack) console.error('Error stack:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err?.message ?? String(err),
  });
});

/**
 * Socket.io namespaces
 */
require('./sockets/crash')(io);
require('./sockets/slide')(io);

/**
 * ✅ PORT + HOST for Railway
 * - Railway provides PORT (required)
 * - Must listen on 0.0.0.0 so public networking can reach your service
 */
const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';

// Start server with error handling
server
  .listen(PORT, HOST, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Socket.io server ready`);

    // Optional: set PUBLIC_URL in Railway to print nicer logs
    // PUBLIC_URL=https://casinobackend-production-98d1.up.railway.app
    const publicUrl = process.env.PUBLIC_URL?.trim();
    if (publicUrl) {
      console.log(`🌐 Public URL: ${publicUrl}`);
      console.log(`❤️  Health: ${publicUrl}/health`);
      console.log(`🔌 API: ${publicUrl}/api`);
    } else {
      console.log(`🌐 API available at http://localhost:${PORT}/api`);
    }
  })
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use.`);
    } else {
      console.error('❌ Server error:', err);
    }
    process.exit(1);
  });
