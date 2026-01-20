const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { getPool } = require('./database/connection');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3002'];
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
// IMPORTANT: parse JSON body - must be before routes
app.use(express.json({ limit: "1mb" }));

// Request logging middleware (for debugging)
app.use((req, res, next) => {
  console.log("REQ:", req.method, req.originalUrl, req.body ? JSON.stringify(req.body).substring(0, 100) : '');
  next();
});

// MySQL connection (initialized on first use)
getPool();

// Import routes
console.log("Loading routes...");
const walletRoutes = require('./routes/wallet');
const tokenPriceRoutes = require('./routes/tokenPrice');
const withdrawRoutes = require('./routes/withdraw');
const mineRoutes = require('./routes/mine');
const videoPokerRoutes = require('./routes/videoPoker');
const txRoutes = require('./routes/tx');
const usersRoutes = require('./routes/users');
console.log("✅ All routes loaded");

// API Routes
app.use('/api/wallet', walletRoutes);
app.use('/api/token-price', tokenPriceRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/mine', mineRoutes);
app.use('/api/video-poker', videoPokerRoutes);
app.use('/api/tx', txRoutes);
app.use('/api/users', usersRoutes);

// Log registered routes on startup
console.log("📋 Registered API routes:");
console.log("  - GET  /health");
console.log("  - POST /api/mine/status");
console.log("  - POST /api/mine/create");
console.log("  - POST /api/mine/pick");
console.log("  - POST /api/mine/reveal");
console.log("  - POST /api/mine/cashout");
console.log("  - POST /api/mine/claim");
console.log("  - GET  /api/mine/test");

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler - must be after all routes, before error handler
app.use((req, res) => {
  console.log("404:", req.method, req.originalUrl);
  res.status(404).json({ 
    error: "Not Found", 
    path: req.originalUrl,
    method: req.method,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// Global error handler - must be after all routes
app.use((err, req, res, next) => {
  console.error('API ERROR:', err);
  console.error('Error stack:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err?.message ?? String(err),
  });
});

// Socket.io namespaces
const crashNamespace = require('./sockets/crash')(io);
const slideNamespace = require('./sockets/slide')(io);

// Validate and set PORT (prevent using MySQL port 3306)
let PORT = parseInt(process.env.PORT || '3001', 10);

// Safety check: if PORT is MySQL port or invalid, use default
if (PORT === 3306 || PORT < 1024 || PORT > 65535 || isNaN(PORT)) {
  console.warn(`⚠️  Invalid PORT (${process.env.PORT}), using default 3001`);
  PORT = 3001;
}

// Start server with error handling
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.io server ready`);
  console.log(`🌐 API available at http://localhost:${PORT}/api`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use.`);
    console.error(`   Please either:`);
    console.error(`   1. Stop the process using port ${PORT}`);
    console.error(`   2. Set PORT to a different value (e.g., PORT=3002 npm run dev)`);
    console.error(`\n   To find what's using port ${PORT}, run:`);
    if (process.platform === 'win32') {
      console.error(`   netstat -ano | findstr :${PORT}`);
    } else {
      console.error(`   lsof -i :${PORT} or netstat -tulpn | grep :${PORT}`);
    }
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
    process.exit(1);
  }
});
