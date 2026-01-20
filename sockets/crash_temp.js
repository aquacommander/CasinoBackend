const { SlideGame } = require('../models/Game');
const crypto = require('crypto');

/**
 * Slide Game Socket.io Namespace
 * Handles /slide namespace
 */
module.exports = function(io) {
  const slideNamespace = io.of('/slide');

  let currentGame = null;
  let gameInterval = null;

  const STATUS = {
    WAITTING: 0,
    STARTING: 1,
    BETTING: 2,
    PLAYING: 3
  };

  // Generate crash point and numbers array
  function generateSlideData(publicSeed, privateSeed) {
    const combined = publicSeed + privateSeed;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    
    // Generate crash point
    const hashNum = parseInt(hash.slice(0, 8), 16);
    const random = (hashNum % 1000000) / 1000000;
    const crashPoint = Math.max(1.0, Math.min(1000.0, parseFloat((1 + random * 999).toFixed(2))));

    // Generate numbers array (simulated sliding numbers)
    const numbers = [];
    let current = 1.0;
    while (current < crashPoint) {
      numbers.push(parseFloat(current.toFixed(2)));
      current += 0.01 + Math.random() * 0.05;
    }
    numbers.push(crashPoint);

    return { crashPoint, numbers };
  }

  // Create a new game
  async function createNewGame() {
    const publicSeed = crypto.randomBytes(32).toString('hex');
    const privateSeed = crypto.randomBytes(32).toString('hex');
    const privateHash = crypto.createHash('sha256').update(privateSeed).digest('hex');

    const { crashPoint, numbers } = generateSlideData(publicSeed, privateSeed);

    const gameData = {
      _id: crypto.randomBytes(16).toString('hex'),
      status: STATUS.STARTING,
      crashPoint,
      numbers,
      publicSeed,
      privateHash,
      players: [],
      createdAt: new Date()
    };

    const game = await SlideGame.create(gameData);
    return game;
  }

  // Start game cycle
  async function startGameCycle() {
    try {
      // Wait period
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Create new game
      currentGame = await createNewGame();
      currentGame.status = STATUS.BETTING;
      await currentGame.save();

      // Emit starting status
      slideNamespace.emit('slide-track', {
        status: STATUS.STARTING,
        _id: currentGame._id,
        publicSeed: currentGame.publicSeed,
        privateHash: currentGame.privateHash
      });

      // Wait 2 seconds for betting
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Start playing
      currentGame.status = STATUS.PLAYING;
      await currentGame.save();

      slideNamespace.emit('slide-track', {
        status: STATUS.BETTING
      });

      // Emit playing status with data
      slideNamespace.emit('slide-track', {
        status: STATUS.PLAYING,
        crashPoint: currentGame.crashPoint,
        numbers: currentGame.numbers,
        players: currentGame.players
      });

      // Wait for game to finish (simulate slide duration)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Game ended, start next cycle
      setTimeout(() => {
        startGameCycle();
      }, 2000);
    } catch (error) {
      console.error('Error in startGameCycle:', error);
      // Retry after a delay to prevent infinite error loop
      setTimeout(() => {
        startGameCycle();
      }, 10000); // Wait 10 seconds before retrying
    }
  }

  slideNamespace.on('connection', (socket) => {
    console.log('Client connected to /slide:', socket.id);

    // Send current game state
    socket.on('games', async () => {
      try {
        const game = await SlideGame.findOne({
          status: { $in: [STATUS.STARTING, STATUS.BETTING, STATUS.PLAYING] }
        }).sort({ createdAt: -1 });

        if (game) {
          socket.emit('slide-track', {
            status: game.status,
            _id: game._id,
            publicSeed: game.publicSeed,
            privateHash: game.privateHash,
            crashPoint: game.crashPoint,
            numbers: game.numbers,
            players: game.players
          });
        } else {
          if (!currentGame) {
            startGameCycle();
          }
        }

        // Send history
        const history = await SlideGame.find({
          status: STATUS.PLAYING,
          select: 'id, crash_point',
          limit: 6
        });

        socket.emit('history', history.map(g => ({
          _id: g._id || g.id,
          resultpoint: g.crashPoint || g.crash_point
        })));
      } catch (error) {
        console.error('Error fetching games:', error);
      }
    });

    // Join game
    socket.on('join-game', async (target, betAmount, currencyId) => {
      try {
        if (!currentGame || currentGame.status !== STATUS.BETTING) {
          socket.emit('game-join-error', 'Game not accepting bets');
          return;
        }

        const player = {
          playerId: socket.id,
          betAmount: Math.floor(betAmount),
          target: Math.floor(target),
          currencyId: currencyId || '',
          status: 'playing'
        };

        currentGame.players.push(player);
        await currentGame.save();

        socket.emit('game-join-sucess', player);
        slideNamespace.emit('bet', player);
      } catch (error) {
        console.error('Error joining game:', error);
        socket.emit('game-join-error', error.message);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected from /slide:', socket.id);
    });
  });

  // Start the first game
  startGameCycle();

  return slideNamespace;
};
