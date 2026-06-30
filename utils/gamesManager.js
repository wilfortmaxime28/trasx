const db = require('../config/db');
const Bot = require('../models/Bot');
const User = require('../models/User');
const { attachBotGameStats, attachUserGameStats } = require('./gameLevel');

const LUDO_LOOP_LENGTH = 52;
const LUDO_FINAL_STEP = 56;
const LUDO_SAFE_GLOBAL_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const LUDO_PLAY_ORDER = [1, 2, 3, 4];
const LUDO_COLOR_BY_SLOT = Object.freeze({
  1: 'red',
  2: 'green',
  3: 'yellow',
  4: 'blue'
});
const LUDO_LABEL_BY_SLOT = Object.freeze({
  1: 'Rouges',
  2: 'Verts',
  3: 'Jaunes',
  4: 'Bleus'
});
const LUDO_START_INDICES = {
  1: 0,
  2: 13,
  3: 26,
  4: 39
};
const CHESS_PIECE_VALUES = Object.freeze({
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000
});
const CHESS_MATE_SCORE = 100000;
const CHESS_INITIAL_TIME_MS = 10 * 60 * 1000;

class GamesManager {
  constructor() {
    this.games = {};
    this.nextGameId = 1;
    this.supportedGameTypes = new Set(['connect4', 'gomoku', 'tablefootball', 'echecs', 'ludo']);
  }

  normalizeRounds(rounds) {
    const parsedRounds = parseInt(rounds, 10);
    if (!Number.isFinite(parsedRounds)) return 1;
    const clamped = Math.max(1, Math.min(7, parsedRounds));
    return clamped % 2 === 0 ? Math.max(1, clamped - 1) : clamped;
  }

  getConfiguredLudoTotalSlots(gameOrType, ludoConfig = null) {
    if (typeof gameOrType === 'string') {
      return gameOrType === 'ludo' ? 2 : 2;
    }

    if (!gameOrType || gameOrType.gameType !== 'ludo') return 2;
    return 2;
  }

  isConfiguredMultiplayerLudo(gameOrType, ludoConfig = null) {
    return this.getConfiguredLudoTotalSlots(gameOrType, ludoConfig) > 2;
  }

  isFourPlayerLudo(gameOrType, ludoConfig = null) {
    return this.getConfiguredLudoTotalSlots(gameOrType, ludoConfig) === 4;
  }

  buildLudoConfig(mode = 'bots', totalSlots = 2) {
    const safeTotalSlots = 2;
    return {
      totalSlots: safeTotalSlots,
      mode: mode === 'players' ? 'players' : 'bots',
      playOrder: [...LUDO_PLAY_ORDER].slice(0, safeTotalSlots)
    };
  }

  getGamePlayerSlots(game) {
    if (game?.gameType === 'ludo') {
      return [...LUDO_PLAY_ORDER].slice(0, this.getConfiguredLudoTotalSlots(game));
    }
    return [1, 2];
  }

  getGamePlayerBySlot(game, slot) {
    if (!game || !Number.isInteger(Number(slot))) return null;
    return game[`player${Number(slot)}`] || null;
  }

  setGamePlayerBySlot(game, slot, player) {
    if (!game || !Number.isInteger(Number(slot))) return;
    game[`player${Number(slot)}`] = player || null;
  }

  getGameParticipants(game) {
    return this.getGamePlayerSlots(game)
      .map((slot) => this.getGamePlayerBySlot(game, slot))
      .filter(Boolean);
  }

  findGamePlayerSlotById(game, userId) {
    if (!game || userId === undefined || userId === null) return 0;
    const normalizedId = String(userId);
    for (const slot of this.getGamePlayerSlots(game)) {
      const player = this.getGamePlayerBySlot(game, slot);
      if (player && String(player.id) === normalizedId) {
        return slot;
      }
    }
    return 0;
  }

  getLudoOccupiedSlots(game) {
    return this.getGamePlayerSlots(game).filter((slot) => !!this.getGamePlayerBySlot(game, slot));
  }

  getNextLudoPlayerSlot(game, currentSlot) {
    const occupiedSlots = this.getLudoOccupiedSlots(game);
    if (occupiedSlots.length <= 1) {
      return occupiedSlots[0] || 1;
    }

    const playOrder = Array.isArray(game?.ludoConfig?.playOrder) && game.ludoConfig.playOrder.length
      ? game.ludoConfig.playOrder.map((slot) => Number(slot)).filter((slot) => Number.isInteger(slot))
      : [...LUDO_PLAY_ORDER];

    const safeCurrentSlot = Number.isInteger(Number(currentSlot)) ? Number(currentSlot) : occupiedSlots[0];
    const currentIndex = playOrder.indexOf(safeCurrentSlot);
    if (currentIndex === -1) {
      return occupiedSlots[0];
    }

    for (let offset = 1; offset < playOrder.length; offset += 1) {
      const candidate = playOrder[(currentIndex + offset) % playOrder.length];
      if (occupiedSlots.includes(candidate)) {
        return candidate;
      }
    }

    return occupiedSlots[0];
  }

  getLudoColorForSlot(playerSlot) {
    return LUDO_COLOR_BY_SLOT[Number(playerSlot)] || 'red';
  }

  getLudoLabelForSlot(playerSlot) {
    return LUDO_LABEL_BY_SLOT[Number(playerSlot)] || 'Joueurs';
  }

  resolveAvatarUrl(entity = {}) {
    const candidates = [
      entity?.avatar,
      entity?.avatar_url,
      entity?.avatarUrl,
      entity?.profile_picture,
      entity?.profilePicture,
      entity?.photo_url,
      entity?.photoUrl,
      entity?.picture
    ];

    const resolved = candidates.find((value) => typeof value === 'string' && value.trim());
    return resolved || '/assets/avatar_placeholder.jpg';
  }

  buildHumanPlayer(user, symbol) {
    const enrichedUser = attachUserGameStats(user || {});
    return {
      id: enrichedUser.id,
      username: enrichedUser.username,
      name: enrichedUser.name || [enrichedUser.first_name, enrichedUser.last_name].filter(Boolean).join(' ').trim(),
      avatar: this.resolveAvatarUrl(enrichedUser),
      symbol,
      isBot: false,
      matchesPlayed: enrichedUser.matchesPlayed || 0,
      matchesWon: enrichedUser.matchesWon || 0,
      winRate: enrichedUser.winRate || 0,
      level: enrichedUser.level || 1,
      levelTitle: enrichedUser.levelTitle || 'Debutant'
    };
  }

  buildBotPlayer(bot, symbol) {
    const enrichedBot = attachBotGameStats(bot || {});
    return {
      id: `bot_${enrichedBot.id}`,
      username: enrichedBot.username,
      name: enrichedBot.name || [enrichedBot.first_name, enrichedBot.last_name].filter(Boolean).join(' ').trim(),
      avatar: this.resolveAvatarUrl(enrichedBot),
      symbol,
      isBot: true,
      wins: enrichedBot.matchesWon || 0,
      matchesPlayed: enrichedBot.matchesPlayed || 0,
      matchesWon: enrichedBot.matchesWon || 0,
      winRate: enrichedBot.winRate || 0,
      level: enrichedBot.level || 1,
      levelTitle: enrichedBot.levelTitle || 'Debutant'
    };
  }

  async recordMatchStatsForPlayer(player, didWin = false) {
    if (!player || !player.id) return;

    if (player.isBot) {
      const botId = parseInt(String(player.id).replace('bot_', ''), 10);
      if (!botId) return;

      await db.execute(
        'UPDATE bots SET matches_played = matches_played + 1, wins = wins + ? WHERE id = ?',
        [didWin ? 1 : 0, botId]
      );

      const nextStats = attachBotGameStats({
        ...player,
        matches_played: Number(player.matchesPlayed || 0) + 1,
        wins: Number(player.matchesWon || player.wins || 0) + (didWin ? 1 : 0)
      });

      Object.assign(player, nextStats, { wins: nextStats.matchesWon });
      return;
    }

    const userId = parseInt(player.id, 10);
    if (!userId) return;

    await db.execute(
      'UPDATE users SET game_matches_played = game_matches_played + 1, game_matches_won = game_matches_won + ? WHERE id = ?',
      [didWin ? 1 : 0, userId]
    );

    const nextStats = attachUserGameStats({
      ...player,
      game_matches_played: Number(player.matchesPlayed || 0) + 1,
      game_matches_won: Number(player.matchesWon || 0) + (didWin ? 1 : 0)
    });

    Object.assign(player, nextStats);
  }

  async recordCompletedMatchStats(game, winnerId) {
    if (!game || winnerId === 'cancelled') return;

    const participants = this.getGameParticipants(game);
    for (const player of participants) {
      const didWin = winnerId !== 'draw' && String(player.id) === String(winnerId);
      await this.recordMatchStatsForPlayer(player, didWin);
    }
  }

  // Retrieve active games (waiting or playing)
  getLiveGames() {
    return Object.values(this.games)
      .filter(game => game.gameType !== 'domino' && game.status !== 'finished' && game.status !== 'invited')
      .map(game => ({
        id: game.id,
        gameType: game.gameType,
        mode: game.mode,
        status: game.status,
        player1: game.player1,
        player2: game.player2,
        player3: game.player3 || null,
        player4: game.player4 || null,
        spectatorCount: game.spectators.length,
        createdAt: game.createdAt,
        startedAt: game.startedAt,
        betAmount: game.betAmount || 0,
        rounds: game.rounds || 1,
        liveMode: game.liveMode || 'free',
        livePrice: game.livePrice || 0,
        maxPlayers: game.gameType === 'ludo'
          ? this.getConfiguredLudoTotalSlots(game)
          : Number(game.maxPlayers || 2),
        joinedPlayers: this.getGameParticipants(game).length,
        ludoConfig: game.ludoConfig || null
      }));
  }

  isUserBusy(userId) {
    if (!userId) return false;
    const numericId = parseInt(userId, 10);
    return Object.values(this.games).some(game => {
      if (!['waiting', 'playing', 'invited'].includes(game.status)) return false;
      return this.getGameParticipants(game).some((player) => {
        if (!player || player.isBot) return false;
        return parseInt(player.id, 10) === numericId;
      });
    });
  }

  // Create a game session
  async createGame(creatorId, creatorInfo, gameType, opponentType, entryMode, opponentId = null, customBetAmount = 1.00, rounds = 1, liveMode = 'free', livePrice = 0.50, team1 = 'FR', team2 = 'BR', options = {}) {
    if (this.isUserBusy(creatorId)) {
      throw new Error("Vous êtes déjà dans une partie ou avez une invitation en attente.");
    }

    if (gameType === 'puissance4') {
      gameType = 'connect4';
    }
    if (gameType === 'morpion') {
      gameType = 'gomoku';
    }
    if (gameType === 'chess' || gameType === 'echec' || gameType === 'echecsmat') {
      gameType = 'echecs';
    }
    if (gameType === 'domino') {
      throw new Error('Le jeu Domino a été retiré de la plateforme.');
    }
    if (!this.supportedGameTypes.has(gameType)) {
      throw new Error('Ce jeu n est plus disponible.');
    }
    const resolvedLudoPartyMode = gameType === 'ludo'
      ? (
        ['bots', 'players'].includes(String(options?.ludoPartyMode || '').toLowerCase())
          ? String(options.ludoPartyMode).toLowerCase()
          : (opponentType === 'bot' ? 'bots' : 'players')
      )
      : null;
    const resolvedLudoOpponentCount = gameType === 'ludo' ? 1 : 1;
    const ludoConfig = gameType === 'ludo'
      ? this.buildLudoConfig(resolvedLudoPartyMode, 2)
      : null;
    const normalizedEntryMode = gameType === 'ludo' ? 'free' : entryMode;
    const normalizedOpponentType = gameType === 'ludo'
      ? (resolvedLudoPartyMode === 'players' ? 'player' : 'bot')
      : opponentType;
    const isP2PInvite = gameType !== 'ludo' && normalizedOpponentType === 'player' && opponentId && !String(opponentId).startsWith('bot_');

    if (isP2PInvite && this.isUserBusy(opponentId)) {
      throw new Error("Cet adversaire est déjà dans une partie ou a une invitation en attente.");
    }

    const isPaid = normalizedEntryMode === 'paid';
    const betAmount = isPaid ? Math.max(0.10, parseFloat(customBetAmount || 1.00)) : 0;
    
    if (isPaid) {
      if (normalizedOpponentType === 'bot') {
        const [creatorRows] = await db.query('SELECT token_balance FROM users WHERE id = ?', [creatorId]);
        const creatorBalance = creatorRows.length > 0 ? parseFloat(creatorRows[0].token_balance || 0) : 0;
        if (creatorBalance < betAmount) {
          throw new Error(`Votre solde en tokens est insuffisant pour jouer avec le robot (${betAmount.toFixed(4)} tokens requis).`);
        }

        const [botBankRows] = await db.query("SELECT id, token_balance FROM users WHERE username = 'botbank' LIMIT 1");
        if (!botBankRows || botBankRows.length === 0) {
          throw new Error("Le compte Bot Bank est introuvable. Impossible de jouer avec le robot.");
        }
        const botBankUser = botBankRows[0];
        const botBankBalance = parseFloat(botBankUser.token_balance || 0);
        if (botBankBalance < betAmount) {
          throw new Error("Le robot refuse de jouer car la banque de robots (Bot Bank) n'a pas assez de tokens.");
        }

        await db.execute('UPDATE users SET token_balance = token_balance - ? WHERE id = ?', [betAmount, creatorId]);
        await db.execute('UPDATE users SET token_balance = token_balance - ? WHERE id = ?', [betAmount, botBankUser.id]);
      } else if (isP2PInvite) {
        const [creatorRows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [creatorId]);
        const creatorBalance = creatorRows.length > 0 ? parseFloat(creatorRows[0].deposit_account_balance || 0) : 0;
        if (creatorBalance < betAmount) {
          throw new Error(`Votre solde est insuffisant pour miser ce montant (${betAmount.toFixed(2)} $ requis).`);
        }

        const [opponentRows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [opponentId]);
        const opponentBalance = opponentRows.length > 0 ? parseFloat(opponentRows[0].deposit_account_balance || 0) : 0;
        if (opponentBalance < betAmount) {
          throw new Error(`Le solde de l'adversaire est insuffisant pour miser ce montant (${betAmount.toFixed(2)} $).`);
        }
      } else {
        const [rows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [creatorId]);
        const balance = rows.length > 0 ? parseFloat(rows[0].deposit_account_balance || 0) : 0;
        if (balance < betAmount) {
          throw new Error(`Solde insuffisant pour créer une partie payante (${betAmount.toFixed(2)} $ requis).`);
        }
        await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [betAmount, creatorId]);
      }
    }

    const gameId = 'game_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const normalizedRounds = gameType === 'ludo' ? 1 : this.normalizeRounds(rounds);
    
    // Initialize board/tiles based on game type
    let board = [];
    let player1Hand = [];
    let player2Hand = [];
    let boneyard = [];
    let leftEnd = null;
    let rightEnd = null;
    let table = [];
    let dominoScores = { player1: 0, player2: 0 };
    let mathState = null;
    let tableFootballState = null;
    let chessState = null;
    let ludoState = null;

    if (gameType === 'domino') {
      const pool = [];
      for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
          pool.push([i, j]);
        }
      }
      // Shuffle pool
      for (let i = pool.length - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[k]] = [pool[k], pool[i]];
      }
      player1Hand = pool.splice(0, 7);
      if (opponentType === 'bot') {
        player2Hand = pool.splice(0, 7);
      }
      boneyard = pool;
    } else if (gameType === 'connect4') {
      board = Array(6).fill(null).map(() => Array(7).fill(0));
    } else if (gameType === 'ludo') {
      ludoState = this.createInitialLudoState(ludoConfig);
      board = [];
    } else if (gameType === 'echecs') {
      chessState = this.createInitialChessState();
      board = chessState.board;
    } else if (gameType === 'mathduel') {
      mathState = {
        scores: { 1: 0, 2: 0 },
        round: 1,
        targetScore: 5,
        currentQuestion: this.generateMathQuestion(),
        lastResult: null
      };
    } else if (gameType === 'tablefootball') {
      tableFootballState = {
        scores: { 1: 0, 2: 0 },
        targetScore: 5,
        positions: {
          p1: [
            { x: 180, y: 55 },  // Goalkeeper
            { x: 100, y: 120 }, // Defenders
            { x: 260, y: 120 },
            { x: 180, y: 200 }, // Midfielder
            { x: 110, y: 260 }, // Attackers
            { x: 250, y: 260 }
          ],
          p2: [
            { x: 180, y: 545 }, // Goalkeeper
            { x: 100, y: 480 }, // Defenders
            { x: 260, y: 480 },
            { x: 180, y: 400 }, // Midfielder
            { x: 110, y: 340 }, // Attackers
            { x: 250, y: 340 }
          ],
          ball: { x: 180, y: 300 }
        },
        lastPlay: null
      };
    } else {
      // gomoku
      board = Array(15).fill(null).map(() => Array(15).fill(0));
    }

    let opponentInfo = null;
    if (isP2PInvite) {
      const opponentUser = await User.getById(opponentId);
      if (opponentUser) {
        opponentInfo = this.buildHumanPlayer(opponentUser, 2);
      } else {
        throw new Error('Adversaire introuvable.');
      }
    }

    const game = {
      id: gameId,
      gameType,
      mode: normalizedEntryMode,
      betAmount: isPaid ? betAmount : 0,
      opponentType: normalizedOpponentType,
      status: isP2PInvite ? 'invited' : (normalizedOpponentType === 'bot' ? 'playing' : 'waiting'),
      rounds: normalizedRounds,
      currentRound: 1,
      roundWins: { player1: 0, player2: 0 },
      liveMode: liveMode || 'free',
      livePrice: liveMode === 'paid' ? Math.max(0.10, parseFloat(livePrice || 0.50)) : 0,
      player1: this.buildHumanPlayer(creatorInfo, 1),
      player2: opponentInfo,
      player3: null,
      player4: null,
      board,
      player1Hand,
      player2Hand,
      boneyard,
      table,
      dominoScores,
      mathState,
      tableFootballState,
      chessState,
      ludoState,
      ludoConfig,
      leftEnd,
      rightEnd,
      currentPlayer: 1,
      winner: null,
      spectators: [],
      createdAt: Date.now(),
      startedAt: (normalizedOpponentType === 'bot') ? Date.now() : null,
      lastActivityAt: Date.now(),
      team1: team1 || 'FR',
      team2: team2 || 'BR',
      maxPlayers: gameType === 'ludo' ? this.getConfiguredLudoTotalSlots(gameType, ludoConfig) : 2
    };

    if (normalizedOpponentType === 'bot') {
      if (gameType === 'ludo') {
        const availableBots = await Bot.getAll();
        const shuffledBots = [...availableBots].sort(() => Math.random() - 0.5);
        const requestedBotIds = Array.isArray(options?.ludoBotIds)
          ? options.ludoBotIds
            .map((botId) => parseInt(botId, 10))
            .filter((botId) => Number.isInteger(botId) && botId > 0)
          : [];
        const requiredBotCount = Math.max(1, this.getConfiguredLudoTotalSlots(gameType, ludoConfig) - 1);
        const selectedBots = [];

        requestedBotIds.forEach((requestedBotId) => {
          const requestedBot = shuffledBots.find((bot) => Number(bot.id) === Number(requestedBotId));
          if (!requestedBot) return;
          if (selectedBots.some((entry) => Number(entry.id) === Number(requestedBot.id))) return;
          selectedBots.push(requestedBot);
        });

        shuffledBots.forEach((bot) => {
          if (selectedBots.length >= requiredBotCount) return;
          if (selectedBots.some((entry) => Number(entry.id) === Number(bot.id))) return;
          selectedBots.push(bot);
        });

        while (selectedBots.length < requiredBotCount && shuffledBots.length > 0) {
          selectedBots.push(shuffledBots[selectedBots.length % shuffledBots.length]);
        }

        if (selectedBots.length < requiredBotCount) {
          throw new Error('Impossible de charger suffisamment de robots pour lancer cette partie de Ludo.');
        }

        if (selectedBots[0]) game.player2 = this.buildBotPlayer(selectedBots[0], 2);
        if (selectedBots[1]) game.player3 = this.buildBotPlayer(selectedBots[1], 3);
        if (selectedBots[2]) game.player4 = this.buildBotPlayer(selectedBots[2], 4);
      } else {
        let bot = null;
        if (opponentId && String(opponentId).startsWith('bot_')) {
          const botId = parseInt(String(opponentId).replace('bot_', ''), 10);
          if (botId) {
            bot = await Bot.getById(botId);
          }
        }
        if (!bot) {
          bot = await Bot.getRandomBot();
        }
        game.player2 = this.buildBotPlayer(bot, 2);
      }
    }

    if (game.gameType === 'echecs' && game.status === 'playing') {
      this.startChessTurnClock(game, Date.now());
    }

    this.games[gameId] = game;
    return game;
  }

  // Join a waiting game
  async joinGame(gameId, player2Id, player2Info, team) {
    if (this.isUserBusy(player2Id)) {
      throw new Error("Vous êtes déjà dans une partie ou avez une invitation en attente.");
    }
    const game = this.games[gameId];
    if (!game) throw new Error('Partie introuvable.');
    if (game.gameType === 'domino') throw new Error('Le jeu Domino a été retiré de la plateforme.');
    if (game.status !== 'waiting') throw new Error('Cette partie n\'est plus disponible.');
    if (game.player1.id === player2Id) throw new Error('Vous ne pouvez pas jouer contre vous-même.');

    if (game.gameType === 'ludo' && this.getConfiguredLudoTotalSlots(game) > 2) {
      const existingSlot = this.findGamePlayerSlotById(game, player2Id);
      if (existingSlot > 0) {
        throw new Error('Vous avez déjà rejoint cette partie.');
      }

      const openSlot = this.getGamePlayerSlots(game)
        .filter((slot) => slot !== 1)
        .find((slot) => !this.getGamePlayerBySlot(game, slot));
      if (!openSlot) {
        throw new Error('La partie de Ludo est déjà complète.');
      }

      this.setGamePlayerBySlot(game, openSlot, this.buildHumanPlayer(player2Info, openSlot));
      if (team && openSlot === 2) {
        game.team2 = team;
      }

      const joinedPlayers = this.getGameParticipants(game).length;
      if (joinedPlayers >= this.getConfiguredLudoTotalSlots(game)) {
        game.status = 'playing';
        game.startedAt = Date.now();
      }

      game.lastActivityAt = Date.now();
      return game;
    }

    const isPaid = game.mode === 'paid';
    if (isPaid) {
      const betAmount = parseFloat(game.betAmount || 0);
      // Check user balance
      const [rows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [player2Id]);
      const balance = rows.length > 0 ? parseFloat(rows[0].deposit_account_balance || 0) : 0;
      if (balance < betAmount) {
        throw new Error(`Solde insuffisant pour rejoindre une partie payante (${betAmount.toFixed(2)} $ requis).`);
      }
      // Deduct entry fee
      await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [betAmount, player2Id]);
    }

    game.player2 = this.buildHumanPlayer(player2Info, 2);
    if (team) {
      game.team2 = team;
    }
    if (game.gameType === 'domino') {
      game.player2Hand = game.boneyard.splice(0, 7);
    }
    game.status = 'playing';
    game.startedAt = Date.now();
    game.lastActivityAt = Date.now();
    if (game.gameType === 'echecs') {
      this.startChessTurnClock(game, Date.now());
    }
    return game;
  }

  // Add spectator
  spectateJoin(gameId, spectatorInfo) {
    const game = this.games[gameId];
    if (!game) return null;
    
    // Check if spectator already in list
    const exists = game.spectators.find(s => s.id === spectatorInfo.id);
    if (!exists) {
      game.spectators.push({
        id: spectatorInfo.id,
        username: spectatorInfo.username,
        name: spectatorInfo.name || (spectatorInfo.first_name + ' ' + spectatorInfo.last_name),
        avatar: spectatorInfo.avatar || '/assets/avatar_placeholder.jpg'
      });
    }
    return game;
  }

  // Remove spectator
  spectateLeave(gameId, spectatorId) {
    const game = this.games[gameId];
    if (!game) return null;
    game.spectators = game.spectators.filter(s => s.id !== spectatorId);
    return game;
  }

  // Play a move
  async makeMove(gameId, playerId, r, c, extraMove = {}) {
    const game = this.games[gameId];
    if (!game) throw new Error('Partie introuvable.');
    if (game.status !== 'playing') throw new Error('La partie n\'est pas en cours.');

    game.lastActivityAt = Date.now();

    const activePlayer = this.getGamePlayerBySlot(game, Number(game.currentPlayer || 1));
    if (!activePlayer) throw new Error('Joueur actif introuvable.');

    // For tablefootball 'sync': the human client simulates physics for BOTH sides
    // (including after a bot shot), so allow either player to submit a sync regardless of whose turn it is.
    const isTableFootballSync = game.gameType === 'tablefootball' && extraMove?.promotion === 'sync';
    const isGameParticipant = this.getGameParticipants(game).some((player) => String(player?.id) === String(playerId));
    if (!isTableFootballSync && String(activePlayer.id) !== String(playerId)) throw new Error('Ce n\'est pas votre tour.');
    if (isTableFootballSync && !isGameParticipant) throw new Error('Ce n\'est pas votre tour.');

    // Ensure numeric coordinates are parsed as integers to prevent string concatenation bugs
    const parsedRow = isNaN(parseInt(r, 10)) ? r : parseInt(r, 10);
    const parsedCol = isNaN(parseInt(c, 10)) ? c : parseInt(c, 10);

    // Validate and update board / table
    let moveRow = parsedRow;
    let moveCol = parsedCol;
    
    if (game.gameType === 'ludo') {
      const actingSlot = game.currentPlayer;
      const ludoState = game.ludoState;
      if (!ludoState) throw new Error('Etat du Ludo introuvable.');

      const actionType = String(extraMove?.promotion || '').toLowerCase();

      if (actionType === 'roll') {
        const rollResult = this.performLudoRoll(game, actingSlot);
        game.lastMove = {
          gameType: 'ludo',
          type: 'roll',
          player: actingSlot,
          roll: rollResult.die,
          autoPass: rollResult.autoPass === true,
          turnCancelled: rollResult.turnCancelled === true
        };
        return {
          success: true,
          game
        };
      }

      const tokenIndex = Number(parsedRow);
      if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
        throw new Error('Pion de Ludo invalide.');
      }

      if (!ludoState.hasRolled || !this.isValidLudoDieValue(ludoState.currentDie)) {
        throw new Error('Lancez le de avant de deplacer un pion.');
      }

      const moveResult = this.applyLudoMove(game, actingSlot, tokenIndex, Number(ludoState.currentDie));
      if (moveResult.finished) {
        return await this.endGame(gameId, activePlayer.id);
      }

      return {
        success: true,
        game
      };
    } else if (game.gameType === 'domino') {
      const tileIndex = r;
      const side = c; // 'left' or 'right'
      const hand = game.currentPlayer === 1 ? game.player1Hand : game.player2Hand;

      if (tileIndex < 0 || tileIndex >= hand.length) {
        throw new Error('Tuile invalide.');
      }
      const tile = hand[tileIndex];

      if (game.table.length === 0) {
        game.table.push(tile);
        game.leftEnd = tile[0];
        game.rightEnd = tile[1];
      } else if (side === 'left') {
        if (tile[1] === game.leftEnd) {
          game.table.unshift(tile);
          game.leftEnd = tile[0];
        } else if (tile[0] === game.leftEnd) {
          const flipped = [tile[1], tile[0]];
          game.table.unshift(flipped);
          game.leftEnd = tile[1];
        } else {
          throw new Error('Le domino ne correspond pas à l\'extrémité gauche.');
        }
      } else if (side === 'right') {
        if (tile[0] === game.rightEnd) {
          game.table.push(tile);
          game.rightEnd = tile[1];
        } else if (tile[1] === game.rightEnd) {
          const flipped = [tile[1], tile[0]];
          game.table.push(flipped);
          game.rightEnd = tile[0];
        } else {
          throw new Error('Le domino ne correspond pas à l\'extrémité droite.');
        }
      } else {
        throw new Error('Coup invalide.');
      }
      hand.splice(tileIndex, 1);
      game.lastMove = {
        gameType: 'domino',
        index: side === 'left' ? 0 : game.table.length - 1
      };

      // Check if player wins
      if (hand.length === 0) {
        return await this.endGame(gameId, activePlayer.id);
      }

      // Check for block
      if (game.boneyard.length === 0 && 
          !this.hasLegalMoves(game.player1Hand, game.leftEnd, game.rightEnd) && 
          !this.hasLegalMoves(game.player2Hand, game.leftEnd, game.rightEnd)) {
        const sum1 = game.player1Hand.reduce((acc, t) => acc + t[0] + t[1], 0);
        const sum2 = game.player2Hand.reduce((acc, t) => acc + t[0] + t[1], 0);
        if (sum1 < sum2) {
          return await this.endGame(gameId, game.player1.id);
        } else if (sum2 < sum1) {
          return await this.endGame(gameId, game.player2.id);
        } else {
          return await this.endGame(gameId, 'draw');
        }
      }
    } else if (game.gameType === 'connect4') {
      // column input c
      if (moveCol < 0 || moveCol >= 7) throw new Error('Colonne invalide.');
      // Drop piece to lowest available row
      let rowFound = -1;
      for (let row = 5; row >= 0; row--) {
        if (game.board[row][moveCol] === 0) {
          rowFound = row;
          break;
        }
      }
      if (rowFound === -1) throw new Error('La colonne est pleine.');
      game.board[rowFound][moveCol] = activePlayer.symbol;
      moveRow = rowFound;
      game.lastMove = {
        gameType: 'connect4',
        r: rowFound,
        c: moveCol
      };

      // Check for win
      const winningStones = this.checkConnectFourWin(game.board, moveRow, moveCol, activePlayer.symbol);
      if (winningStones) {
        return await this.endGame(gameId, activePlayer.id, winningStones);
      }
      // Check for draw
      if (this.isBoardFull(game)) {
        return await this.endGame(gameId, 'draw');
      }
    } else if (game.gameType === 'gomoku') {
      if (moveRow < 0 || moveRow >= 15 || moveCol < 0 || moveCol >= 15 || game.board[moveRow][moveCol] !== 0) {
        throw new Error('Coup invalide.');
      }
      game.board[moveRow][moveCol] = activePlayer.symbol;
      game.lastMove = {
        gameType: 'gomoku',
        r: moveRow,
        c: moveCol
      };

      // Check for win
      const winningStones = this.checkGomokuWin(game.board, moveRow, moveCol, activePlayer.symbol);
      if (winningStones) {
        return await this.endGame(gameId, activePlayer.id, winningStones);
      }
      // Check for draw
      if (this.isBoardFull(game)) {
        return await this.endGame(gameId, 'draw');
      }
    } else if (game.gameType === 'echecs') {
      const chessState = game.chessState;
      if (!chessState) throw new Error('État des échecs introuvable.');
      this.ensureChessStateRuntime(chessState, game.currentPlayer);

      const remainingBeforeMove = this.syncChessClock(game, Date.now());
      if (remainingBeforeMove <= 0) {
        return await this.resolveChessTimeout(gameId);
      }

      const fromRow = Number(parsedRow);
      const fromCol = Number(parsedCol);
      const toRow = Number(extraMove?.toR);
      const toCol = Number(extraMove?.toC);
      const promotion = String(extraMove?.promotion || 'q').toLowerCase();
      const allowedPromotions = new Set(['q', 'r', 'b', 'n']);

      if (![fromRow, fromCol, toRow, toCol].every(Number.isInteger)) {
        throw new Error('Coup d échecs invalide.');
      }
      if (!allowedPromotions.has(promotion)) {
        throw new Error('Promotion invalide.');
      }

      const legalMoves = this.getLegalChessMoves(chessState, activePlayer.symbol);
      const chosenMove = legalMoves.find((move) =>
        move.from.r === fromRow
        && move.from.c === fromCol
        && move.to.r === toRow
        && move.to.c === toCol
        && (!move.promotion || move.promotion === promotion)
      );

      if (!chosenMove) {
        throw new Error('Ce coup n est pas autorisé.');
      }

      const isPawnMove = this.getChessPieceType(chosenMove.piece) === 'p';
      const isCaptureMove = !!chosenMove.captured;
      this.applyChessMove(chessState, chosenMove);
      game.board = chessState.board;
      game.lastMove = {
        gameType: 'echecs',
        from: chosenMove.from,
        to: chosenMove.to,
        piece: chosenMove.piece,
        captured: chosenMove.captured || null,
        castle: chosenMove.castle || null,
        promotion: chosenMove.promotion || null
      };

      chessState.halfmoveClock = (isPawnMove || isCaptureMove) ? 0 : Number(chessState.halfmoveClock || 0) + 1;
      if (activePlayer.symbol === 2) {
        chessState.fullmoveNumber = Number(chessState.fullmoveNumber || 1) + 1;
      }

      const opponentSymbol = this.getChessOpponentSymbol(activePlayer.symbol);
      const opponentMoves = this.getLegalChessMoves(chessState, opponentSymbol);
      const opponentInCheck = this.isChessKingInCheck(chessState.board, opponentSymbol);
      const isCheckmate = opponentInCheck && opponentMoves.length === 0;
      const isStalemate = !opponentInCheck && opponentMoves.length === 0;

      chessState.moveHistory.push(
        this.buildChessMoveHistoryEntry(chessState, chosenMove, activePlayer.symbol, {
          inCheck: opponentInCheck,
          isMate: isCheckmate
        })
      );

      if (isCheckmate) {
        game.currentPlayer = opponentSymbol;
        chessState.statusMessage = this.buildChessStatusMessage({ isMate: true });
        chessState.lastEvent = { type: 'checkmate', player: opponentSymbol, at: Date.now() };
        return await this.endGame(gameId, activePlayer.id, null, false, {
          reason: 'checkmate',
          message: activePlayer.symbol === 1 ? 'Victoire des Blancs par echec et mat.' : 'Victoire des Noirs par echec et mat.'
        });
      }

      if (isStalemate) {
        game.currentPlayer = opponentSymbol;
        chessState.statusMessage = this.buildChessStatusMessage({ isStalemate: true });
        chessState.lastEvent = { type: 'stalemate', player: opponentSymbol, at: Date.now() };
        return await this.endGame(gameId, 'draw', null, false, {
          reason: 'stalemate',
          message: 'Pat. Match nul.'
        });
      }

      game.currentPlayer = opponentSymbol;

      const repetitionCount = this.recordChessPosition(chessState, game.currentPlayer);
      if (repetitionCount >= 3) {
        chessState.statusMessage = this.buildChessStatusMessage({ reason: 'threefold-repetition' });
        chessState.lastEvent = { type: 'draw', reason: 'threefold-repetition', at: Date.now() };
        return await this.endGame(gameId, 'draw', null, false, {
          reason: 'threefold-repetition',
          message: 'Match nul par triple repetition.'
        });
      }

      if (Number(chessState.halfmoveClock || 0) >= 100) {
        chessState.statusMessage = this.buildChessStatusMessage({ reason: 'fifty-move-rule' });
        chessState.lastEvent = { type: 'draw', reason: 'fifty-move-rule', at: Date.now() };
        return await this.endGame(gameId, 'draw', null, false, {
          reason: 'fifty-move-rule',
          message: 'Match nul par regle des 50 coups.'
        });
      }

      if (this.isChessInsufficientMaterial(chessState.board)) {
        chessState.statusMessage = this.buildChessStatusMessage({ reason: 'insufficient-material' });
        chessState.lastEvent = { type: 'draw', reason: 'insufficient-material', at: Date.now() };
        return await this.endGame(gameId, 'draw', null, false, {
          reason: 'insufficient-material',
          message: 'Match nul par materiel insuffisant.'
        });
      }

      chessState.statusMessage = this.buildChessStatusMessage({
        currentPlayer: game.currentPlayer,
        inCheck: opponentInCheck
      });
      chessState.lastEvent = opponentInCheck
        ? { type: 'check', player: opponentSymbol, at: Date.now() }
        : null;
      game.resultReason = null;
      game.resultMessage = null;
      this.startChessTurnClock(game, Date.now());

      return {
        success: true,
        game
      };
    } else if (game.gameType === 'mathduel') {
      const mathState = game.mathState;
      if (!mathState || !mathState.currentQuestion) {
        throw new Error('Question math introuvable.');
      }

      const answerIndex = Number(parsedCol);
      if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= mathState.currentQuestion.choices.length) {
        throw new Error('Réponse invalide.');
      }

      const isCorrect = answerIndex === mathState.currentQuestion.correctIndex;
      if (isCorrect) {
        mathState.scores[game.currentPlayer] = Number(mathState.scores[game.currentPlayer] || 0) + 1;
      }

      mathState.lastResult = {
        player: game.currentPlayer,
        selectedIndex: answerIndex,
        correctIndex: mathState.currentQuestion.correctIndex,
        correct: isCorrect,
        prompt: mathState.currentQuestion.prompt
      };

      if (mathState.scores[game.currentPlayer] >= mathState.targetScore) {
        return await this.endGame(gameId, activePlayer.id);
      }

      mathState.round += 1;
      mathState.currentQuestion = this.generateMathQuestion();
    } else if (game.gameType === 'tablefootball') {
      const footballState = game.tableFootballState;
      if (!footballState) throw new Error('Match de football introuvable.');

      const actionType = extraMove?.promotion || 'shot';

      if (actionType === 'shot') {
        const puckIndex = Number(parsedRow);
        const vx = Number(extraMove?.toR) / 1000;
        const vy = Number(extraMove?.toC) / 1000;

        if (!Number.isInteger(puckIndex) || puckIndex < 0 || puckIndex > 5) {
          throw new Error('Puck invalide.');
        }
        if (isNaN(vx) || isNaN(vy)) {
          throw new Error('Impulsion de tir invalide.');
        }

        // Record the shot so the opponent can animate it locally
        footballState.lastPlay = {
          type: 'shot',
          playerSlot: game.currentPlayer,
          puckIndex,
          vx,
          vy
        };

        return { success: true, game };
      } else if (actionType === 'sync') {
        const finalState = extraMove?.finalState;
        if (!finalState || !finalState.positions || !finalState.scores) {
          throw new Error('Données de synchronisation invalides.');
        }

        footballState.positions = finalState.positions;
        footballState.scores = finalState.scores;
        footballState.lastPlay = null; // Clear last play

        const targetScore = footballState.targetScore || 5;
        if (Number(footballState.scores[1]) >= targetScore) {
          return await this.endGame(gameId, game.player1.id);
        }
        if (Number(footballState.scores[2]) >= targetScore) {
          const winnerId = game.player2.id;
          return await this.endGame(gameId, winnerId);
        }

        // Switch turn or assign custom next player
        if (extraMove && extraMove.nextPlayer) {
          game.currentPlayer = Number(extraMove.nextPlayer);
        } else {
          game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;
        }
        return { success: true, game };
      } else {
        throw new Error('Action de football inconnue.');
      }
    }

    // Switch player
    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;

    return {
      success: true,
      game
    };
  }

  // Trigger bot's play
  async makeBotMove(gameId) {
    const game = this.games[gameId];
    if (!game || game.status !== 'playing') return;

    const botSlot = Number(game.currentPlayer || 1);
    const botPlayer = this.getGamePlayerBySlot(game, botSlot);
    if (!botPlayer || !botPlayer.isBot) return;

    // Race-condition guard: by the time the delayed timeout fires, the turn may have
    // already changed (e.g. an extra sync arrived and flipped currentPlayer back to 1).
    // Silently bail out instead of crashing with 'Ce n'est pas votre tour.'
    if (Number(game.currentPlayer || 1) !== botSlot) return;

    if (game.gameType === 'ludo') {
      const ludoState = game.ludoState;
      if (!ludoState) return;

      if (!ludoState.hasRolled) {
        const rollResult = this.performLudoRoll(game, botSlot);
        game.lastMove = {
          gameType: 'ludo',
          type: 'roll',
          player: botSlot,
          roll: rollResult.die,
          autoPass: rollResult.autoPass === true,
          turnCancelled: rollResult.turnCancelled === true
        };

        return {
          success: true,
          game,
          botMove: { type: 'roll', die: rollResult.die },
          botAction: 'roll',
          continueTurn: rollResult.autoPass !== true && game.status === 'playing' && game.currentPlayer === botSlot && game.ludoState?.hasRolled === true
        };
      }

      const dieValue = this.isValidLudoDieValue(ludoState.currentDie)
        ? Number(ludoState.currentDie)
        : null;
      const legalMoves = dieValue === null ? [] : this.getLudoLegalMoves(game, botSlot, dieValue);
      const chosenMove = this.chooseLudoBotMove(game, legalMoves);

      if (!chosenMove) {
        ludoState.currentDie = null;
        ludoState.hasRolled = false;
        ludoState.legalMoves = [];
        ludoState.turnMessage = 'Le robot passe son tour.';
        game.currentPlayer = this.getNextLudoPlayerSlot(game, botSlot);
        return {
          success: true,
          game,
          botMove: null,
          botAction: 'move',
          continueTurn: false
        };
      }

      const moveResult = this.applyLudoMove(game, botSlot, chosenMove.tokenIndex, dieValue);
      const botMove = {
        type: 'move',
        die: dieValue,
        tokenIndex: chosenMove.tokenIndex
      };

      if (moveResult.finished) {
        const endResult = await this.endGame(gameId, botPlayer.id);
        return {
          ...endResult,
          botMove,
          botAction: 'move',
          continueTurn: false
        };
      }

      return {
        success: true,
        game,
        botMove,
        botAction: 'move',
        continueTurn: moveResult.extraTurn === true && game.status === 'playing' && game.currentPlayer === botSlot
      };
    } else if (game.gameType === 'domino') {
      const hand = game.player2Hand;
      const moves = [];
      for (let i = 0; i < hand.length; i++) {
        const tile = hand[i];
        if (game.leftEnd === null || game.rightEnd === null) {
          moves.push({ tileIndex: i, side: 'left' });
        } else {
          if (tile[0] === game.leftEnd || tile[1] === game.leftEnd) {
            moves.push({ tileIndex: i, side: 'left' });
          }
          if (tile[0] === game.rightEnd || tile[1] === game.rightEnd) {
            moves.push({ tileIndex: i, side: 'right' });
          }
        }
      }

      if (moves.length > 0) {
        const isPaidMode = game.mode === 'paid';
        if (isPaidMode) {
          // Professional heuristic lookahead for paid matches (Extreme difficulty)
          moves.sort((a, b) => {
            const tileA = hand[a.tileIndex];
            const tileB = hand[b.tileIndex];

            // Evaluate state after move A
            const nextHandA = hand.filter((_, idx) => idx !== a.tileIndex);
            const leftEndA = a.side === 'left' ? (tileA[0] === game.leftEnd ? tileA[1] : tileA[0]) : game.leftEnd;
            const rightEndA = a.side === 'right' ? (tileA[1] === game.rightEnd ? tileA[0] : tileA[1]) : game.rightEnd;
            const matchesA = nextHandA.filter(t => t[0] === leftEndA || t[1] === leftEndA || t[0] === rightEndA || t[1] === rightEndA).length;

            // Evaluate state after move B
            const nextHandB = hand.filter((_, idx) => idx !== b.tileIndex);
            const leftEndB = b.side === 'left' ? (tileB[0] === game.leftEnd ? tileB[1] : tileB[0]) : game.leftEnd;
            const rightEndB = b.side === 'right' ? (tileB[1] === game.rightEnd ? tileB[0] : tileB[1]) : game.rightEnd;
            const matchesB = nextHandB.filter(t => t[0] === leftEndB || t[1] === leftEndB || t[0] === rightEndB || t[1] === rightEndB).length;

            // Prefer moves that maximize the number of valid matches left in the bot's hand
            if (matchesA !== matchesB) {
              return matchesB - matchesA;
            }

            // Fallback 1: Prefer doubles
            const isDoubleA = tileA[0] === tileA[1];
            const isDoubleB = tileB[0] === tileB[1];
            if (isDoubleA && !isDoubleB) return -1;
            if (!isDoubleA && isDoubleB) return 1;

            // Fallback 2: Prefer higher sum of pips to exhaust high value tiles
            return (tileB[0] + tileB[1]) - (tileA[0] + tileA[1]);
          });
        } else {
          // Choose best move: prefer double tiles first, or highest sum of pips
          moves.sort((a, b) => {
            const tileA = hand[a.tileIndex];
            const tileB = hand[b.tileIndex];
            const isDoubleA = tileA[0] === tileA[1];
            const isDoubleB = tileB[0] === tileB[1];
            if (isDoubleA && !isDoubleB) return -1;
            if (!isDoubleA && isDoubleB) return 1;
            return (tileB[0] + tileB[1]) - (tileA[0] + tileA[1]);
          });
        }
        const chosenMove = moves[0];
        const tile = hand[chosenMove.tileIndex];
        const tileIndex = chosenMove.tileIndex;
        const side = chosenMove.side;

        if (game.table.length === 0) {
          game.table.push(tile);
          game.leftEnd = tile[0];
          game.rightEnd = tile[1];
        } else if (side === 'left') {
          if (tile[1] === game.leftEnd) {
            game.table.unshift(tile);
            game.leftEnd = tile[0];
          } else {
            const flipped = [tile[1], tile[0]];
            game.table.unshift(flipped);
            game.leftEnd = tile[1];
          }
        } else if (side === 'right') {
          if (tile[0] === game.rightEnd) {
            game.table.push(tile);
            game.rightEnd = tile[1];
          } else {
            const flipped = [tile[1], tile[0]];
            game.table.push(flipped);
            game.rightEnd = tile[0];
          }
        }
        hand.splice(tileIndex, 1);
        game.lastMove = {
          gameType: 'domino',
          index: side === 'left' ? 0 : game.table.length - 1
        };

        // Check if bot wins
        if (hand.length === 0) {
          return await this.endGame(gameId, game.player2.id);
        }

        // Check if game is blocked
        if (game.boneyard.length === 0 && 
            !this.hasLegalMoves(game.player1Hand, game.leftEnd, game.rightEnd) && 
            !this.hasLegalMoves(game.player2Hand, game.leftEnd, game.rightEnd)) {
          const sum1 = game.player1Hand.reduce((acc, t) => acc + t[0] + t[1], 0);
          const sum2 = game.player2Hand.reduce((acc, t) => acc + t[0] + t[1], 0);
          if (sum1 < sum2) {
            return await this.endGame(gameId, game.player1.id);
          } else if (sum2 < sum1) {
            return await this.endGame(gameId, game.player2.id);
          } else {
            return await this.endGame(gameId, 'draw');
          }
        }

        game.currentPlayer = 1;

        return {
          success: true,
          game,
          botMove: { tile, side }
        };
      }

      // If no legal moves, must draw from boneyard
      if (game.boneyard.length > 0) {
        let drewPlayable = false;
        while (game.boneyard.length > 0) {
          const tile = game.boneyard.pop();
          hand.push(tile);
          if (tile[0] === game.leftEnd || tile[1] === game.leftEnd ||
              tile[0] === game.rightEnd || tile[1] === game.rightEnd) {
            drewPlayable = true;
            break;
          }
        }

        if (drewPlayable) {
          return await this.makeBotMove(gameId);
        } else {
          // Boneyard empty and no moves: bot must pass!
          game.currentPlayer = 1;
          return {
            success: true,
            game,
            botMove: null
          };
        }
      } else {
        // No boneyard left and no moves: bot must pass!
        game.currentPlayer = 1;
        return {
          success: true,
          game,
          botMove: null
        };
      }
    } else {
      // Board games bot moves (Connect 4, Gomoku)
      let botMove = null;
      const isPaidMode = game.mode === 'paid';
      if (game.gameType === 'connect4') {
        botMove = this.getConnectFourAIMove(game.board, game.player2.symbol, game.player1.symbol, isPaidMode);
      } else if (game.gameType === 'echecs') {
        const legalMoves = this.getLegalChessMoves(game.chessState, 2);
        if (!legalMoves.length) return;
        const searchDepth = this.getChessBotSearchDepth(game, legalMoves.length);
        const bestMove = this.findBestChessMove(game.chessState, 2, searchDepth, legalMoves);
        if (!bestMove) return;
        return await this.makeMove(
          gameId,
          game.player2.id,
          bestMove.from.r,
          bestMove.from.c,
          { toR: bestMove.to.r, toC: bestMove.to.c, promotion: bestMove.promotion || 'q' }
        );
      } else if (game.gameType === 'mathduel') {
        const question = game.mathState?.currentQuestion;
        if (!question) return;
        const shouldAnswerCorrect = Math.random() < (isPaidMode ? 0.96 : 0.88);
        let answerIndex = question.correctIndex;
        if (!shouldAnswerCorrect) {
          const wrongChoices = question.choices.map((_, index) => index).filter((index) => index !== question.correctIndex);
          answerIndex = wrongChoices[Math.floor(Math.random() * wrongChoices.length)];
        }
        return await this.makeMove(gameId, game.player2.id, 0, answerIndex);
      } else if (game.gameType === 'tablefootball') {
        const footballState = game.tableFootballState;
        if (!footballState || !footballState.positions) return;

        const botPucks = footballState.positions.p2;
        const ball = footballState.positions.ball;

        // Choose the puck closest to the ball (no random selection, as requested)
        let bestPuckIndex = 0;
        let minDist = Infinity;
        botPucks.forEach((p, index) => {
          const dx = ball.x - p.x;
          const dy = ball.y - p.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < minDist) {
            minDist = dist;
            bestPuckIndex = index;
          }
        });

        const chosenPuck = botPucks[bestPuckIndex];

        // Opponent's camp is at the top (Y = 50).
        // If the closest puck is below the ball (chosenPuck.y > ball.y), it can shoot towards the opponent's camp.
        // If chosenPuck.y <= ball.y, it is in front of the ball, so it must perform a pass.
        const canShoot = chosenPuck.y > ball.y;

        let dx, dy, force;

        if (canShoot) {
          // Shoot towards the opponent's goal (target around X=180, Y=50)
          const errorMargin = isPaidMode ? 10 : 35;
          const targetGoalX = 180 + (Math.random() * 2 - 1) * errorMargin;
          const targetGoalY = 50;

          const dx_goal = targetGoalX - ball.x;
          const dy_goal = targetGoalY - ball.y;
          const dist_goal = Math.sqrt(dx_goal*dx_goal + dy_goal*dy_goal) || 1;

          // Ghost ball position for hitting the ball towards the goal
          const collisionDist = 16 + 10; // PUCK_RADIUS + BALL_RADIUS
          const targetX = ball.x - (dx_goal / dist_goal) * collisionDist;
          const targetY = ball.y - (dy_goal / dist_goal) * collisionDist;

          dx = targetX - chosenPuck.x;
          dy = targetY - chosenPuck.y;
          force = 10 + Math.random() * 4.5; // High velocity for shot (max 14.5)
        } else {
          // Make a pass to a teammate.
          // Find teammates (other bot pucks)
          const teammates = botPucks.filter((_, index) => index !== bestPuckIndex);
          // Prefer teammates that are behind the ball (T.y > ball.y)
          const candidates = teammates.filter(p => p.y > ball.y);

          let targetTeammate = null;
          if (candidates.length > 0) {
            // Choose the candidate closest to the ball to receive the pass
            let minTeammateDist = Infinity;
            candidates.forEach(p => {
              const tx = p.x - ball.x;
              const ty = p.y - ball.y;
              const dist = Math.sqrt(tx*tx + ty*ty);
              if (dist < minTeammateDist) {
                minTeammateDist = dist;
                targetTeammate = p;
              }
            });
          }

          // Fallback if no teammates are below the ball: pass to the first available teammate
          if (!targetTeammate && teammates.length > 0) {
            targetTeammate = teammates[0];
          }

          if (targetTeammate) {
            const dx_pass = targetTeammate.x - ball.x;
            const dy_pass = targetTeammate.y - ball.y;
            const dist_pass = Math.sqrt(dx_pass*dx_pass + dy_pass*dy_pass) || 1;

            // Ghost ball position for passing the ball to the teammate
            const collisionDist = 16 + 10; // PUCK_RADIUS + BALL_RADIUS
            const targetX = ball.x - (dx_pass / dist_pass) * collisionDist;
            const targetY = ball.y - (dy_pass / dist_pass) * collisionDist;

            dx = targetX - chosenPuck.x;
            dy = targetY - chosenPuck.y;
            force = 5.5 + Math.random() * 3; // Lower velocity for a pass (max 8.5)
          } else {
            // Ultimate fallback: aim at the ball
            dx = ball.x - chosenPuck.x;
            dy = ball.y - chosenPuck.y;
            force = 6;
          }
        }

        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const vx = (dx / dist) * force;
        const vy = (dy / dist) * force;

        return await this.makeMove(
          gameId,
          game.player2.id,
          bestPuckIndex,
          0,
          {
            toR: Math.round(vx * 1000),
            toC: Math.round(vy * 1000),
            promotion: 'shot'
          }
        );
      } else if (game.gameType === 'gomoku') {
        botMove = this.getGomokuAIMove(game.board, game.player2.symbol, game.player1.symbol, isPaidMode);
      }

      if (!botMove) return;

      const { r, c } = botMove;
      let finalRow = r;
      let finalCol = c;

      if (game.gameType === 'connect4') {
        let rowFound = -1;
        for (let row = 5; row >= 0; row--) {
          if (game.board[row][c] === 0) {
            rowFound = row;
            break;
          }
        }
        game.board[rowFound][c] = game.player2.symbol;
        finalRow = rowFound;
      } else {
        game.board[r][c] = game.player2.symbol;
      }

      game.lastMove = {
        gameType: game.gameType,
        r: finalRow,
        c: finalCol
      };

      // Check for win
      let winningStones = null;
      if (game.gameType === 'connect4') {
        winningStones = this.checkConnectFourWin(game.board, finalRow, finalCol, game.player2.symbol);
      } else if (game.gameType === 'gomoku') {
        winningStones = this.checkGomokuWin(game.board, finalRow, finalCol, game.player2.symbol);
      }

      if (winningStones) {
        return await this.endGame(gameId, game.player2.id, winningStones);
      }

      // Check for draw
      if (this.isBoardFull(game)) {
        return await this.endGame(gameId, 'draw');
      }

      game.currentPlayer = 1;

      return {
        success: true,
        game,
        botMove: { r: finalRow, c: finalCol }
      };
    }
  }

  async resolveChessTimeout(gameId, now = Date.now()) {
    const game = this.games[gameId];
    if (!game || game.gameType !== 'echecs' || game.status !== 'playing' || !game.chessState) return null;

    this.ensureChessStateRuntime(game.chessState, game.currentPlayer || 1);
    const remaining = this.syncChessClock(game, now);
    if (remaining > 0) return null;

    const timedOutSlot = Number(game.currentPlayer || 1);
    const opponentSlot = this.getChessOpponentSymbol(timedOutSlot);
    game.chessState.clock.remainingMs[timedOutSlot] = 0;
    game.chessState.clock.turnStartedAt = null;
    game.chessState.clock.lastUpdatedAt = now;

    const opponentCanMate = this.hasChessSufficientMaterialForMate(game.chessState.board, opponentSlot);
    const winnerId = opponentCanMate
      ? (opponentSlot === 1 ? game.player1.id : game.player2.id)
      : 'draw';
    const reason = opponentCanMate ? 'timeout' : 'timeout-draw';
    const message = opponentCanMate
      ? this.getChessTimeoutResultMessage(game, winnerId)
      : 'Match nul au temps pour materiel insuffisant.';

    game.chessState.statusMessage = this.buildChessStatusMessage({ reason });
    game.chessState.lastEvent = { type: 'timeout', player: timedOutSlot, at: now };

    return await this.endGame(gameId, winnerId, null, false, { reason, message });
  }

  // Handle Game forfeit
  async forfeitGame(gameId, forfeitingPlayerId) {
    const game = this.games[gameId];
    if (!game || game.status !== 'playing') return;

    if (game.gameType === 'ludo' && this.getConfiguredLudoTotalSlots(game) > 2) {
      return await this.endGame(gameId, 'cancelled', null, true, {
        reason: 'multiplayer-forfeit',
        message: 'La partie de Ludo a été annulée après l abandon d un joueur.'
      });
    }

    if (game.gameType === 'echecs') {
      this.stopChessClock(game, Date.now());
      if (game.chessState) {
        game.chessState.statusMessage = 'Abandon.';
        game.chessState.lastEvent = { type: 'resign', player: game.player1.id === forfeitingPlayerId ? 1 : 2, at: Date.now() };
      }
    }

    const winnerId = game.player1.id === forfeitingPlayerId ? game.player2.id : game.player1.id;
    return await this.endGame(gameId, winnerId, null, true, {
      reason: 'resign',
      message: String(winnerId) === String(game.player1?.id) ? 'Victoire des Blancs par abandon.' : 'Victoire des Noirs par abandon.'
    });
  }

  resetGameForNextRound(game) {
    if (game.gameType === 'domino') {
      const pool = [];
      for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
          pool.push([i, j]);
        }
      }
      // Shuffle pool
      for (let i = pool.length - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[k]] = [pool[k], pool[i]];
      }
      game.player1Hand = pool.splice(0, 7);
      if (game.player2) {
        game.player2Hand = pool.splice(0, 7);
      }
      game.boneyard = pool;
      game.table = [];
      game.leftEnd = null;
      game.rightEnd = null;
    } else if (game.gameType === 'ludo') {
      game.ludoState = this.createInitialLudoState(game.ludoConfig);
      game.board = [];
    } else if (game.gameType === 'echecs') {
      game.chessState = this.createInitialChessState(1);
      game.board = game.chessState.board;
    } else if (game.gameType === 'connect4') {
      game.board = Array(6).fill(null).map(() => Array(7).fill(0));
    } else if (game.gameType === 'gomoku') {
      game.board = Array(15).fill(null).map(() => Array(15).fill(0));
    } else if (game.gameType === 'tablefootball') {
      game.tableFootballState = {
        scores: { 1: 0, 2: 0 },
        targetScore: 5,
        positions: {
          p1: [
            { x: 180, y: 80 },
            { x: 100, y: 150 },
            { x: 260, y: 150 },
            { x: 130, y: 240 },
            { x: 230, y: 240 }
          ],
          p2: [
            { x: 180, y: 520 },
            { x: 100, y: 450 },
            { x: 260, y: 450 },
            { x: 130, y: 360 },
            { x: 230, y: 360 }
          ],
          ball: { x: 180, y: 300 }
        },
        lastPlay: null
      };
    } else if (game.gameType === 'mathduel') {
      game.mathState = {
        scores: { 1: 0, 2: 0 },
        round: 1,
        targetScore: 5,
        currentQuestion: this.generateMathQuestion(),
        lastResult: null
      };
    }
    game.currentPlayer = game.gameType === 'echecs' ? 1 : (game.nextRoundStarter === 2 ? 2 : 1);
    game.winner = null;
    game.winningStones = null;
    game.pendingNextRound = null;
    game.nextRoundStarter = null;
    game.resultReason = null;
    game.resultMessage = null;
  }

  startNextRound(gameId) {
    const game = this.games[gameId];
    if (!game || game.status !== 'round-transition') return null;

    game.currentRound = game.pendingNextRound || ((game.currentRound || 1) + 1);
    game.status = 'playing';
    this.resetGameForNextRound(game);
    if (game.gameType === 'echecs') {
      this.startChessTurnClock(game, Date.now());
    }
    return game;
  }

  // End game and handle payouts / rounds
  async endGame(gameId, winnerId, winningStones = null, isForfeit = false, meta = {}) {
    const game = this.games[gameId];
    if (!game) return;

    if (game.gameType === 'echecs') {
      this.stopChessClock(game, Date.now());
    }

    const resultReason = meta?.reason || null;
    const resultMessage = meta?.message || null;

    if (game.gameType === 'domino' && !game.dominoScores) {
      game.dominoScores = { player1: 0, player2: 0 };
    }

    if (game.gameType === 'domino' && winnerId !== 'draw' && winnerId !== 'cancelled' && !isForfeit) {
      const player1Remaining = (game.player1Hand || []).reduce((acc, tile) => acc + Number(tile[0] || 0) + Number(tile[1] || 0), 0);
      const player2Remaining = (game.player2Hand || []).reduce((acc, tile) => acc + Number(tile[0] || 0) + Number(tile[1] || 0), 0);

      if (String(winnerId) === String(game.player1?.id)) {
        game.dominoScores.player1 = Number(game.dominoScores.player1 || 0) + player2Remaining;
      } else if (String(winnerId) === String(game.player2?.id)) {
        game.dominoScores.player2 = Number(game.dominoScores.player2 || 0) + player1Remaining;
      }
    }

    if (game.rounds && game.rounds > 1 && !isForfeit) {
      if (!game.roundWins) {
        game.roundWins = { player1: 0, player2: 0 };
      }

      if (winnerId !== 'draw') {
        const isPlayer1Winner = game.player1.id === winnerId;
        if (isPlayer1Winner) {
          game.roundWins.player1 = (game.roundWins.player1 || 0) + 1;
        } else {
          game.roundWins.player2 = (game.roundWins.player2 || 0) + 1;
        }
      }

      const totalRoundsPlayed = Number(game.currentRound || 1);
      const configuredRounds = Number(game.rounds || 1);
      const player1WonMatch = totalRoundsPlayed >= configuredRounds && (game.roundWins.player1 || 0) > (game.roundWins.player2 || 0);
      const player2WonMatch = totalRoundsPlayed >= configuredRounds && (game.roundWins.player2 || 0) > (game.roundWins.player1 || 0);
      const isDrawMatch = totalRoundsPlayed >= configuredRounds && !player1WonMatch && !player2WonMatch;

      if (player1WonMatch || player2WonMatch || isDrawMatch) {
        const matchWinnerId = player1WonMatch ? game.player1.id : (player2WonMatch ? game.player2.id : 'draw');
        game.status = 'finished';
        game.winner = matchWinnerId;
        game.winningStones = winningStones;
        game.resultReason = resultReason;
        game.resultMessage = resultMessage;
        await this.recordCompletedMatchStats(game, matchWinnerId);

        const isPaid = game.mode === 'paid';
        if (isPaid) {
          const betAmount = parseFloat(game.betAmount || 0);
          const totalPayout = betAmount * 2;
          const isBotGame = (game.player2 && game.player2.isBot);
          
          if (isBotGame) {
            let botBankId = null;
            const [botBankRows] = await db.query("SELECT id FROM users WHERE username = 'botbank' LIMIT 1");
            if (botBankRows && botBankRows.length > 0) {
              botBankId = botBankRows[0].id;
            }
            if (matchWinnerId === 'draw') {
              if (game.player1) {
                await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [betAmount, game.player1.id]);
              }
              if (botBankId) {
                await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [betAmount, botBankId]);
              }
            } else {
              const winner = player1WonMatch ? game.player1 : game.player2;
              if (winner) {
                if (!winner.isBot) {
                  await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [totalPayout, winner.id]);
                } else if (botBankId) {
                  await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [totalPayout, botBankId]);
                }
              }
            }
          } else {
            if (matchWinnerId === 'draw') {
              if (game.player1 && !game.player1.isBot) {
                await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [betAmount, game.player1.id]);
              }
              if (game.player2 && !game.player2.isBot) {
                await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [betAmount, game.player2.id]);
              }
            } else {
              const winner = player1WonMatch ? game.player1 : game.player2;
              if (winner && !winner.isBot) {
                await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [totalPayout, winner.id]);
              }
            }
          }
        }

        return {
          success: true,
          game,
          finished: true,
          winnerId: matchWinnerId,
          winningStones,
          isForfeit: false,
          resultReason,
          resultMessage
        };
      } else {
        const nextRound = (game.currentRound || 1) + 1;
        game.status = 'round-transition';
        game.winningStones = winningStones;
        game.pendingNextRound = nextRound;
        game.nextRoundStarter = winnerId === game.player2.id ? 2 : 1;

        return {
          success: true,
          game,
          finished: false,
          roundWinnerId: winnerId,
          winningStones,
          nextRound
        };
      }
    } else {
      game.status = 'finished';
      game.winner = winnerId;
      game.winningStones = winningStones;
      game.resultReason = resultReason;
      game.resultMessage = resultMessage;
      await this.recordCompletedMatchStats(game, winnerId);

      const isPaid = game.mode === 'paid';
      if (isPaid) {
        const betAmount = parseFloat(game.betAmount || 0);
        const totalPayout = betAmount * 2;
        const isBotGame = (game.player2 && game.player2.isBot);
        
        if (isBotGame) {
          let botBankId = null;
          const [botBankRows] = await db.query("SELECT id FROM users WHERE username = 'botbank' LIMIT 1");
          if (botBankRows && botBankRows.length > 0) {
            botBankId = botBankRows[0].id;
          }
          if (winnerId === 'draw' || winnerId === 'cancelled') {
            if (game.player1) {
              await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [betAmount, game.player1.id]);
            }
            if (botBankId) {
              await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [betAmount, botBankId]);
            }
          } else {
            const isPlayer1Winner = game.player1.id === winnerId;
            const winner = isPlayer1Winner ? game.player1 : game.player2;
            
            if (winner) {
              if (!winner.isBot) {
                await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [totalPayout, winner.id]);
              } else if (botBankId) {
                await db.execute('UPDATE users SET token_balance = token_balance + ? WHERE id = ?', [totalPayout, botBankId]);
              }
            }
          }
        } else {
          if (winnerId === 'draw' || winnerId === 'cancelled') {
            if (game.player1 && !game.player1.isBot) {
              await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [betAmount, game.player1.id]);
            }
            if (game.player2 && !game.player2.isBot) {
              await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [betAmount, game.player2.id]);
            }
          } else {
            const isPlayer1Winner = game.player1.id === winnerId;
            const winner = isPlayer1Winner ? game.player1 : game.player2;
            
            if (winner && !winner.isBot) {
              await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance + ? WHERE id = ?', [totalPayout, winner.id]);
            }
          }
        }
      }

      return {
        success: true,
        game,
        finished: true,
        winnerId,
        winningStones,
        isForfeit,
        resultReason,
        resultMessage
      };
    }
  }

  // Helper check if board is full
  isBoardFull(game) {
    const board = game.board;
    if (game.gameType === 'connect4') {
      return board[0].every(cell => cell !== 0); // If top row has no empty cells, it's full
    } else if (game.gameType === 'gomoku') {
      return board.every(row => row.every(cell => cell !== 0));
    }
    return false;
  }

  generateMathQuestion() {
    const operations = ['+', '-', 'x'];
    const operator = operations[Math.floor(Math.random() * operations.length)];
    let a = 0;
    let b = 0;
    let answer = 0;

    if (operator === '+') {
      a = 5 + Math.floor(Math.random() * 45);
      b = 5 + Math.floor(Math.random() * 45);
      answer = a + b;
    } else if (operator === '-') {
      a = 20 + Math.floor(Math.random() * 50);
      b = 5 + Math.floor(Math.random() * 20);
      if (b > a) [a, b] = [b, a];
      answer = a - b;
    } else {
      a = 2 + Math.floor(Math.random() * 10);
      b = 2 + Math.floor(Math.random() * 10);
      answer = a * b;
    }

    const choices = new Set([answer]);
    while (choices.size < 4) {
      const delta = (Math.floor(Math.random() * 9) + 1) * (Math.random() > 0.5 ? 1 : -1);
      const candidate = Math.max(0, answer + delta);
      choices.add(candidate);
    }

    const shuffledChoices = Array.from(choices).sort(() => Math.random() - 0.5);
    return {
      prompt: `${a} ${operator} ${b}`,
      choices: shuffledChoices,
      correctIndex: shuffledChoices.indexOf(answer),
      answer
    };
  }

  createInitialLudoState(config = null) {
    const totalSlots = this.getConfiguredLudoTotalSlots('ludo', config);
    const slotList = [...LUDO_PLAY_ORDER].slice(0, totalSlots);
    const players = {};

    slotList.forEach((playerSlot) => {
      players[playerSlot] = {
        color: this.getLudoColorForSlot(playerSlot),
        label: this.getLudoLabelForSlot(playerSlot),
        startIndex: LUDO_START_INDICES[playerSlot],
        tokens: [-1, -1, -1, -1],
        finishedTokens: 0
      };
    });

    const consecutiveSixes = {};
    slotList.forEach((playerSlot) => {
      consecutiveSixes[playerSlot] = 0;
    });

    return {
      currentDie: null,
      lastRoll: null,
      lastRollPlayer: null,
      rollNonce: 0,
      hasRolled: false,
      legalMoves: [],
      turnMessage: 'Lancez le de pour commencer.',
      consecutiveSixes,
      players
    };
  }

  getLudoPlayerState(ludoState, playerSlot) {
    return ludoState && ludoState.players ? ludoState.players[playerSlot] : null;
  }

  getLudoConsecutiveSixCount(ludoState, playerSlot) {
    if (!ludoState) return 0;
    if (!ludoState.consecutiveSixes || typeof ludoState.consecutiveSixes !== 'object') {
      ludoState.consecutiveSixes = {};
    }
    const slot = Number.isInteger(Number(playerSlot)) ? Number(playerSlot) : 1;
    if (ludoState.consecutiveSixes[slot] === undefined) {
      ludoState.consecutiveSixes[slot] = 0;
    }
    const count = Number(ludoState.consecutiveSixes[slot] || 0);
    return Number.isInteger(count) && count >= 0 ? count : 0;
  }

  setLudoConsecutiveSixCount(ludoState, playerSlot, count) {
    if (!ludoState) return;
    if (!ludoState.consecutiveSixes || typeof ludoState.consecutiveSixes !== 'object') {
      ludoState.consecutiveSixes = {};
    }
    const slot = Number.isInteger(Number(playerSlot)) ? Number(playerSlot) : 1;
    ludoState.consecutiveSixes[slot] = Math.max(0, Number.isInteger(Number(count)) ? Number(count) : 0);
  }

  isValidLudoDieValue(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 6;
  }

  getLudoGlobalIndex(playerSlot, step) {
    if (!Number.isInteger(step) || step < 0 || step >= 51) {
      return null;
    }
    const startIndex = LUDO_START_INDICES[playerSlot] || 0;
    return (startIndex + step) % LUDO_LOOP_LENGTH;
  }

  isLudoSafeSquare(globalIndex) {
    return LUDO_SAFE_GLOBAL_INDICES.has(Number(globalIndex));
  }

  getLudoTokensOnGlobalIndex(playerState, playerSlot, globalIndex) {
    if (!playerState || globalIndex === null || globalIndex === undefined) return [];

    const tokens = [];
    playerState.tokens.forEach((step, tokenIndex) => {
      if (!Number.isInteger(step) || step < 0 || step >= 51) return;
      if (this.getLudoGlobalIndex(playerSlot, step) === globalIndex) {
        tokens.push(tokenIndex);
      }
    });
    return tokens;
  }

  getLudoBlockadeOwnerAtGlobalIndex(ludoState, globalIndex) {
    if (!ludoState || globalIndex === null || globalIndex === undefined) return null;

    const playerSlots = Object.keys(ludoState.players || {}).map((slot) => Number(slot)).filter((slot) => Number.isInteger(slot));
    for (const playerSlot of playerSlots) {
      const playerState = this.getLudoPlayerState(ludoState, playerSlot);
      const tokensAtSquare = this.getLudoTokensOnGlobalIndex(playerState, playerSlot, globalIndex);
      if (tokensAtSquare.length >= 2) {
        return playerSlot;
      }
    }

    return null;
  }

  hasLudoBlockadeOnPath(game, playerSlot, fromStep, toStep) {
    return false;
  }

  refreshLudoFinishedCounts(ludoState) {
    Object.keys(ludoState?.players || {}).forEach((slot) => {
      const playerSlot = Number(slot);
      const playerState = this.getLudoPlayerState(ludoState, playerSlot);
      if (!playerState) return;
      playerState.finishedTokens = playerState.tokens.filter((step) => step === LUDO_FINAL_STEP).length;
    });
  }

  getLudoLegalMoves(game, playerSlot, dieValue = null) {
    const ludoState = game.ludoState;
    const playerState = this.getLudoPlayerState(ludoState, playerSlot);
    const die = this.isValidLudoDieValue(dieValue)
      ? Number(dieValue)
      : (this.isValidLudoDieValue(ludoState?.currentDie) ? Number(ludoState.currentDie) : null);

    if (!playerState || die === null) {
      return [];
    }

    const moves = [];

    playerState.tokens.forEach((currentStep, tokenIndex) => {
      if (currentStep === LUDO_FINAL_STEP) return;

      let targetStep = null;
      if (currentStep === -1) {
        if (die !== 6) return;
        targetStep = 0;
      } else {
        targetStep = currentStep + die;
        if (targetStep > LUDO_FINAL_STEP) return;
      }

      if (this.hasLudoBlockadeOnPath(game, playerSlot, currentStep, targetStep)) {
        return;
      }

      const move = {
        tokenIndex,
        fromStep: currentStep,
        toStep: targetStep,
        entersBoard: currentStep === -1,
        reachesHome: targetStep === LUDO_FINAL_STEP,
        willCapture: false,
        isSafe: false,
        opponentTokensAtTarget: []
      };

      if (targetStep < 51) {
        const globalIndex = this.getLudoGlobalIndex(playerSlot, targetStep);
        move.globalIndex = globalIndex;
        move.isSafe = this.isLudoSafeSquare(globalIndex);
        move.opponentTokensAtTarget = [];

        this.getLudoOccupiedSlots(game).forEach((opponentSlot) => {
          if (Number(opponentSlot) === Number(playerSlot)) return;
          const opponentState = this.getLudoPlayerState(ludoState, opponentSlot);
          const matchingTokens = this.getLudoTokensOnGlobalIndex(opponentState, opponentSlot, globalIndex);
          matchingTokens.forEach((opponentTokenIndex) => {
            move.opponentTokensAtTarget.push({
              playerSlot: opponentSlot,
              tokenIndex: opponentTokenIndex
            });
          });
        });

        if (move.isSafe) {
          move.willCapture = false;
        } else {
          move.willCapture = move.opponentTokensAtTarget.length === 1;
        }
      } else {
        move.homeLaneIndex = targetStep - 51;
      }

      moves.push(move);
    });

    return moves;
  }

  getLudoNoMoveMessage(game, playerSlot, dieValue = null) {
    const ludoState = game.ludoState;
    const playerState = this.getLudoPlayerState(ludoState, playerSlot);
    const die = this.isValidLudoDieValue(dieValue) ? Number(dieValue) : null;

    if (!playerState || die === null) {
      return 'Aucun pion ne peut avancer.';
    }

    const allTokensInBase = playerState.tokens.every((step) => step === -1);
    if (allTokensInBase && die !== 6) {
      return `De ${die}. Il faut faire 6 pour sortir un pion de la base.`;
    }

    return `De ${die}. Aucun pion ne peut avancer.`;
  }

  performLudoRoll(game, playerSlot, forcedDie = null) {
    const ludoState = game.ludoState;
    if (!ludoState) {
      throw new Error('Etat du Ludo introuvable.');
    }
    if (ludoState.hasRolled) {
      throw new Error('Le de a deja ete lance pour ce tour.');
    }

    const die = this.isValidLudoDieValue(forcedDie)
      ? Number(forcedDie)
      : (Math.floor(Math.random() * 6) + 1);

    ludoState.currentDie = die;
    ludoState.lastRoll = die;
    ludoState.lastRollPlayer = playerSlot;
    ludoState.rollNonce = Number.isInteger(Number(ludoState.rollNonce)) ? Number(ludoState.rollNonce) + 1 : 1;

    const consecutiveSixCount = die === 6
      ? this.getLudoConsecutiveSixCount(ludoState, playerSlot) + 1
      : 0;
    this.setLudoConsecutiveSixCount(ludoState, playerSlot, consecutiveSixCount);

    if (die === 6 && consecutiveSixCount >= 3) {
      ludoState.currentDie = null;
      ludoState.hasRolled = false;
      ludoState.legalMoves = [];
      this.setLudoConsecutiveSixCount(ludoState, playerSlot, 0);
      ludoState.turnMessage = 'Trois 6 consecutifs ! Tour annule, au joueur suivant.';
      game.currentPlayer = this.getNextLudoPlayerSlot(game, playerSlot);
      return {
        die,
        autoPass: true,
        turnCancelled: true,
        legalMoves: []
      };
    }

    ludoState.hasRolled = true;

    const legalMoves = this.getLudoLegalMoves(game, playerSlot, die);
    ludoState.legalMoves = legalMoves.map((move) => move.tokenIndex);

    if (legalMoves.length === 0) {
      ludoState.currentDie = null;
      ludoState.hasRolled = false;
      ludoState.legalMoves = [];
      ludoState.turnMessage = this.getLudoNoMoveMessage(game, playerSlot, die);
      this.setLudoConsecutiveSixCount(ludoState, playerSlot, 0);
      game.currentPlayer = this.getNextLudoPlayerSlot(game, playerSlot);
      return {
        die,
        autoPass: true,
        legalMoves: []
      };
    }

    ludoState.turnMessage = legalMoves.length === 1
      ? `De ${die}. Un seul pion peut avancer.`
      : `De ${die}. Choisissez un pion a avancer.`;

    return {
      die,
      autoPass: false,
      legalMoves
    };
  }

  applyLudoMove(game, playerSlot, tokenIndex, dieValue = null) {
    const ludoState = game.ludoState;
    const playerState = this.getLudoPlayerState(ludoState, playerSlot);
    const die = this.isValidLudoDieValue(dieValue)
      ? Number(dieValue)
      : (this.isValidLudoDieValue(ludoState?.currentDie) ? Number(ludoState.currentDie) : null);

    if (!ludoState || !playerState) {
      throw new Error('Etat du Ludo introuvable.');
    }
    if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
      throw new Error('Pion de Ludo invalide.');
    }
    if (die === null) {
      throw new Error('Valeur de de invalide.');
    }

    const legalMoves = this.getLudoLegalMoves(game, playerSlot, die);
    const chosenMove = legalMoves.find((move) => move.tokenIndex === tokenIndex);
    if (!chosenMove) {
      throw new Error('Ce pion ne peut pas etre deplace avec ce lancer.');
    }

    playerState.tokens[tokenIndex] = chosenMove.toStep;

    const capturedTokens = [];
    if (chosenMove.willCapture && Number.isInteger(chosenMove.globalIndex)) {
      chosenMove.opponentTokensAtTarget.forEach(({ playerSlot: opponentSlot, tokenIndex: opponentTokenIndex }) => {
        const opponentState = this.getLudoPlayerState(ludoState, opponentSlot);
        if (!opponentState || !Number.isInteger(opponentTokenIndex)) return;
        opponentState.tokens[opponentTokenIndex] = -1;
        capturedTokens.push({
          playerSlot: opponentSlot,
          tokenIndex: opponentTokenIndex
        });
      });
    }

    this.refreshLudoFinishedCounts(ludoState);

    const reachedHome = chosenMove.toStep === LUDO_FINAL_STEP;
    const extraTurn = die === 6 || capturedTokens.length > 0 || reachedHome;

    ludoState.currentDie = null;
    ludoState.hasRolled = false;
    ludoState.legalMoves = [];
    if (capturedTokens.length > 0) {
      ludoState.turnMessage = 'Capture reussie ! Vous rejouez.';
    } else if (reachedHome) {
      ludoState.turnMessage = 'Un pion est arrive a la maison ! Vous rejouez.';
    } else if (die === 6) {
      ludoState.turnMessage = 'Six obtenu ! Vous rejouez.';
    } else {
      ludoState.turnMessage = 'Tour termine.';
    }

    if (die !== 6 || !extraTurn) {
      this.setLudoConsecutiveSixCount(ludoState, playerSlot, 0);
    }

    game.lastMove = {
      gameType: 'ludo',
      type: 'move',
      player: playerSlot,
      tokenIndex,
      roll: die,
      fromStep: chosenMove.fromStep,
      toStep: chosenMove.toStep,
      capturedTokens,
      reachedHome
    };

    if (playerState.finishedTokens >= 4) {
      ludoState.turnMessage = `${playerState.label} remportent la partie !`;
      this.setLudoConsecutiveSixCount(ludoState, playerSlot, 0);
      return {
        finished: true,
        extraTurn,
        chosenMove,
        capturedTokens,
        reachedHome
      };
    }

    if (!extraTurn) {
      game.currentPlayer = this.getNextLudoPlayerSlot(game, playerSlot);
    }

    return {
      finished: false,
      extraTurn,
      chosenMove,
      capturedTokens,
      reachedHome
    };
  }

  chooseLudoBotMove(game, legalMoves = []) {
    if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
      return null;
    }

    const scoredMoves = legalMoves
      .map((move) => {
        let score = Number(move.toStep || 0);
        if (move.reachesHome) score += 1000;
        if (move.willCapture) score += 650;
        if (move.entersBoard) score += 280;
        if (move.isSafe) score += 120;
        if (move.toStep >= 51) score += 80;
        return { move, score };
      })
      .sort((a, b) => b.score - a.score);

    return scoredMoves[0] ? scoredMoves[0].move : null;
  }

  createInitialChessState(currentPlayer = 1) {
    const board = [
      ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
      ['bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp'],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp'],
      ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr']
    ];
    const state = {
      board,
      castling: {
        whiteKingSide: true,
        whiteQueenSide: true,
        blackKingSide: true,
        blackQueenSide: true
      },
      enPassant: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
      moveHistory: [],
      positionCounts: {},
      positionHistory: [],
      statusMessage: 'Traits aux Blancs',
      lastEvent: null,
      clock: {
        initialMs: CHESS_INITIAL_TIME_MS,
        remainingMs: {
          1: CHESS_INITIAL_TIME_MS,
          2: CHESS_INITIAL_TIME_MS
        },
        turnStartedAt: null,
        lastUpdatedAt: null
      }
    };
    const initialKey = this.getChessPositionKey(state, currentPlayer);
    state.positionCounts[initialKey] = 1;
    state.positionHistory.push(initialKey);
    return state;
  }

  getChessColorBySymbol(symbol) {
    return symbol === 1 ? 'w' : 'b';
  }

  getChessSymbolByColor(color) {
    return color === 'w' ? 1 : 2;
  }

  cloneChessState(chessState) {
    return {
      board: chessState.board.map((row) => [...row]),
      castling: { ...chessState.castling },
      enPassant: chessState.enPassant ? { ...chessState.enPassant } : null,
      halfmoveClock: Number(chessState.halfmoveClock || 0),
      fullmoveNumber: Number(chessState.fullmoveNumber || 1),
      moveHistory: Array.isArray(chessState.moveHistory) ? chessState.moveHistory.map((entry) => ({ ...entry })) : [],
      positionCounts: chessState.positionCounts ? { ...chessState.positionCounts } : {},
      positionHistory: Array.isArray(chessState.positionHistory) ? [...chessState.positionHistory] : [],
      statusMessage: chessState.statusMessage || '',
      lastEvent: chessState.lastEvent ? { ...chessState.lastEvent } : null,
      clock: chessState.clock ? {
        initialMs: Number(chessState.clock.initialMs || CHESS_INITIAL_TIME_MS),
        remainingMs: {
          1: Number(chessState.clock.remainingMs?.[1] ?? CHESS_INITIAL_TIME_MS),
          2: Number(chessState.clock.remainingMs?.[2] ?? CHESS_INITIAL_TIME_MS)
        },
        turnStartedAt: chessState.clock.turnStartedAt ? Number(chessState.clock.turnStartedAt) : null,
        lastUpdatedAt: chessState.clock.lastUpdatedAt ? Number(chessState.clock.lastUpdatedAt) : null
      } : {
        initialMs: CHESS_INITIAL_TIME_MS,
        remainingMs: { 1: CHESS_INITIAL_TIME_MS, 2: CHESS_INITIAL_TIME_MS },
        turnStartedAt: null,
        lastUpdatedAt: null
      }
    };
  }

  ensureChessStateRuntime(chessState, currentPlayer = 1) {
    if (!chessState) return null;

    if (!Number.isFinite(Number(chessState.halfmoveClock))) chessState.halfmoveClock = 0;
    if (!Number.isFinite(Number(chessState.fullmoveNumber)) || Number(chessState.fullmoveNumber) < 1) chessState.fullmoveNumber = 1;
    if (!Array.isArray(chessState.moveHistory)) chessState.moveHistory = [];
    if (!Array.isArray(chessState.positionHistory)) chessState.positionHistory = [];
    if (!chessState.positionCounts || typeof chessState.positionCounts !== 'object') chessState.positionCounts = {};
    if (!chessState.clock || typeof chessState.clock !== 'object') {
      chessState.clock = {};
    }

    chessState.clock.initialMs = Number(chessState.clock.initialMs || CHESS_INITIAL_TIME_MS);
    chessState.clock.remainingMs = chessState.clock.remainingMs || {};
    chessState.clock.remainingMs[1] = Math.max(0, Number(chessState.clock.remainingMs[1] ?? chessState.clock.initialMs));
    chessState.clock.remainingMs[2] = Math.max(0, Number(chessState.clock.remainingMs[2] ?? chessState.clock.initialMs));
    chessState.clock.turnStartedAt = chessState.clock.turnStartedAt ? Number(chessState.clock.turnStartedAt) : null;
    chessState.clock.lastUpdatedAt = chessState.clock.lastUpdatedAt ? Number(chessState.clock.lastUpdatedAt) : null;

    const positionKey = this.getChessPositionKey(chessState, currentPlayer);
    if (!chessState.positionHistory.length) {
      chessState.positionHistory.push(positionKey);
    }
    if (!chessState.positionCounts[positionKey]) {
      chessState.positionCounts[positionKey] = 1;
    }
    if (typeof chessState.statusMessage !== 'string' || !chessState.statusMessage) {
      chessState.statusMessage = currentPlayer === 1 ? 'Traits aux Blancs' : 'Traits aux Noirs';
    }

    return chessState;
  }

  getChessSquareName(r, c) {
    return `${String.fromCharCode(97 + c)}${8 - r}`;
  }

  getChessPieceNotationLetter(piece) {
    const type = this.getChessPieceType(piece);
    if (!type || type === 'p') return '';
    if (type === 'n') return 'N';
    return type.toUpperCase();
  }

  getChessPositionKey(chessState, currentSymbol) {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let emptyCount = 0;
      let rowText = '';
      for (let c = 0; c < 8; c++) {
        const piece = chessState.board[r][c];
        if (!piece) {
          emptyCount += 1;
        } else {
          if (emptyCount > 0) {
            rowText += String(emptyCount);
            emptyCount = 0;
          }
          rowText += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1];
        }
      }
      if (emptyCount > 0) rowText += String(emptyCount);
      rows.push(rowText);
    }

    let castlingText = '';
    if (chessState.castling?.whiteKingSide) castlingText += 'K';
    if (chessState.castling?.whiteQueenSide) castlingText += 'Q';
    if (chessState.castling?.blackKingSide) castlingText += 'k';
    if (chessState.castling?.blackQueenSide) castlingText += 'q';
    if (!castlingText) castlingText = '-';

    const enPassantText = chessState.enPassant
      ? this.getChessSquareName(chessState.enPassant.r, chessState.enPassant.c)
      : '-';

    return `${rows.join('/')} ${currentSymbol === 1 ? 'w' : 'b'} ${castlingText} ${enPassantText}`;
  }

  recordChessPosition(chessState, currentSymbol) {
    this.ensureChessStateRuntime(chessState, currentSymbol);
    const key = this.getChessPositionKey(chessState, currentSymbol);
    chessState.positionHistory.push(key);
    chessState.positionCounts[key] = Number(chessState.positionCounts[key] || 0) + 1;
    return chessState.positionCounts[key];
  }

  getEffectiveChessRemainingMs(game, playerSlot, now = Date.now()) {
    if (!game?.chessState) return 0;
    this.ensureChessStateRuntime(game.chessState, game.currentPlayer || 1);

    const clock = game.chessState.clock;
    let remaining = Math.max(0, Number(clock.remainingMs?.[playerSlot] ?? clock.initialMs));
    if (
      game.status === 'playing'
      && Number(game.currentPlayer) === Number(playerSlot)
      && Number.isFinite(Number(clock.turnStartedAt))
      && Number(clock.turnStartedAt) > 0
    ) {
      remaining = Math.max(0, remaining - Math.max(0, now - Number(clock.turnStartedAt)));
    }
    return remaining;
  }

  syncChessClock(game, now = Date.now()) {
    if (!game || game.gameType !== 'echecs' || !game.chessState) return null;
    this.ensureChessStateRuntime(game.chessState, game.currentPlayer || 1);

    const clock = game.chessState.clock;
    const activeSlot = Number(game.currentPlayer || 1);
    if (!Number.isFinite(Number(clock.turnStartedAt)) || Number(clock.turnStartedAt) <= 0) {
      clock.turnStartedAt = now;
      clock.lastUpdatedAt = now;
      return Math.max(0, Number(clock.remainingMs[activeSlot] || 0));
    }

    const elapsed = Math.max(0, now - Number(clock.turnStartedAt));
    if (elapsed > 0) {
      clock.remainingMs[activeSlot] = Math.max(0, Number(clock.remainingMs[activeSlot] || 0) - elapsed);
    }
    clock.turnStartedAt = now;
    clock.lastUpdatedAt = now;
    return Math.max(0, Number(clock.remainingMs[activeSlot] || 0));
  }

  startChessTurnClock(game, now = Date.now()) {
    if (!game || game.gameType !== 'echecs' || !game.chessState) return;
    this.ensureChessStateRuntime(game.chessState, game.currentPlayer || 1);
    game.chessState.clock.turnStartedAt = now;
    game.chessState.clock.lastUpdatedAt = now;
  }

  stopChessClock(game, now = Date.now()) {
    if (!game || game.gameType !== 'echecs' || !game.chessState) return;
    this.syncChessClock(game, now);
    game.chessState.clock.turnStartedAt = null;
    game.chessState.clock.lastUpdatedAt = now;
  }

  isInsideChessBoard(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  getChessPieceColor(piece) {
    if (!piece) return null;
    return piece[0];
  }

  getChessPieceType(piece) {
    if (!piece) return null;
    return piece[1];
  }

  findChessKing(board, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === `${color}k`) return { r, c };
      }
    }
    return null;
  }

  isChessSquareAttacked(board, targetR, targetC, byColor) {
    const knightDirs = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    const kingDirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const bishopDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const rookDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    const pawnDir = byColor === 'w' ? -1 : 1;
    for (const dc of [-1, 1]) {
      const pr = targetR - pawnDir;
      const pc = targetC - dc;
      if (this.isInsideChessBoard(pr, pc) && board[pr][pc] === `${byColor}p`) return true;
    }

    for (const [dr, dc] of knightDirs) {
      const nr = targetR + dr;
      const nc = targetC + dc;
      if (this.isInsideChessBoard(nr, nc) && board[nr][nc] === `${byColor}n`) return true;
    }

    for (const [dr, dc] of bishopDirs) {
      let nr = targetR + dr;
      let nc = targetC + dc;
      while (this.isInsideChessBoard(nr, nc)) {
        const piece = board[nr][nc];
        if (piece) {
          if (this.getChessPieceColor(piece) === byColor && ['b', 'q'].includes(this.getChessPieceType(piece))) {
            return true;
          }
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    for (const [dr, dc] of rookDirs) {
      let nr = targetR + dr;
      let nc = targetC + dc;
      while (this.isInsideChessBoard(nr, nc)) {
        const piece = board[nr][nc];
        if (piece) {
          if (this.getChessPieceColor(piece) === byColor && ['r', 'q'].includes(this.getChessPieceType(piece))) {
            return true;
          }
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    for (const [dr, dc] of kingDirs) {
      const nr = targetR + dr;
      const nc = targetC + dc;
      if (this.isInsideChessBoard(nr, nc) && board[nr][nc] === `${byColor}k`) return true;
    }

    return false;
  }

  isChessKingInCheck(board, symbol) {
    const color = this.getChessColorBySymbol(symbol);
    const enemyColor = color === 'w' ? 'b' : 'w';
    const king = this.findChessKing(board, color);
    if (!king) return true;
    return this.isChessSquareAttacked(board, king.r, king.c, enemyColor);
  }

  getPseudoChessMoves(chessState, symbol) {
    const board = chessState.board;
    const color = this.getChessColorBySymbol(symbol);
    const enemyColor = color === 'w' ? 'b' : 'w';
    const moves = [];

    const pushMove = (move) => moves.push(move);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece || this.getChessPieceColor(piece) !== color) continue;
        const type = this.getChessPieceType(piece);

        if (type === 'p') {
          const dir = color === 'w' ? -1 : 1;
          const startRow = color === 'w' ? 6 : 1;
          const promotionRow = color === 'w' ? 0 : 7;
          const nextRow = r + dir;
          if (this.isInsideChessBoard(nextRow, c) && !board[nextRow][c]) {
            if (nextRow === promotionRow) {
              pushMove({ from: { r, c }, to: { r: nextRow, c }, piece, promotion: 'q' });
            } else {
              pushMove({ from: { r, c }, to: { r: nextRow, c }, piece });
            }
            const doubleRow = r + dir * 2;
            if (r === startRow && !board[doubleRow][c]) {
              pushMove({ from: { r, c }, to: { r: doubleRow, c }, piece, pawnDouble: true });
            }
          }
          for (const dc of [-1, 1]) {
            const cr = r + dir;
            const cc = c + dc;
            if (!this.isInsideChessBoard(cr, cc)) continue;
            const target = board[cr][cc];
            if (target && this.getChessPieceColor(target) === enemyColor) {
              if (cr === promotionRow) {
                pushMove({ from: { r, c }, to: { r: cr, c: cc }, piece, captured: target, promotion: 'q' });
              } else {
                pushMove({ from: { r, c }, to: { r: cr, c: cc }, piece, captured: target });
              }
            } else if (chessState.enPassant && chessState.enPassant.r === cr && chessState.enPassant.c === cc) {
              pushMove({ from: { r, c }, to: { r: cr, c: cc }, piece, enPassant: true, captured: `${enemyColor}p` });
            }
          }
        } else if (type === 'n') {
          for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
            const nr = r + dr;
            const nc = c + dc;
            if (!this.isInsideChessBoard(nr, nc)) continue;
            const target = board[nr][nc];
            if (!target || this.getChessPieceColor(target) === enemyColor) {
              pushMove({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: target || null });
            }
          }
        } else if (['b', 'r', 'q'].includes(type)) {
          const dirs = [];
          if (['b', 'q'].includes(type)) dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
          if (['r', 'q'].includes(type)) dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
          for (const [dr, dc] of dirs) {
            let nr = r + dr;
            let nc = c + dc;
            while (this.isInsideChessBoard(nr, nc)) {
              const target = board[nr][nc];
              if (!target) {
                pushMove({ from: { r, c }, to: { r: nr, c: nc }, piece });
              } else {
                if (this.getChessPieceColor(target) === enemyColor) {
                  pushMove({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: target });
                }
                break;
              }
              nr += dr;
              nc += dc;
            }
          }
        } else if (type === 'k') {
          for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
            const nr = r + dr;
            const nc = c + dc;
            if (!this.isInsideChessBoard(nr, nc)) continue;
            const target = board[nr][nc];
            if (!target || this.getChessPieceColor(target) === enemyColor) {
              pushMove({ from: { r, c }, to: { r: nr, c: nc }, piece, captured: target || null });
            }
          }

          const inCheck = this.isChessSquareAttacked(board, r, c, enemyColor);
          if (!inCheck && color === 'w' && r === 7 && c === 4) {
            if (chessState.castling.whiteKingSide && !board[7][5] && !board[7][6]
              && !this.isChessSquareAttacked(board, 7, 5, enemyColor)
              && !this.isChessSquareAttacked(board, 7, 6, enemyColor)
              && board[7][7] === 'wr') {
              pushMove({ from: { r, c }, to: { r: 7, c: 6 }, piece, castle: 'king' });
            }
            if (chessState.castling.whiteQueenSide && !board[7][1] && !board[7][2] && !board[7][3]
              && !this.isChessSquareAttacked(board, 7, 3, enemyColor)
              && !this.isChessSquareAttacked(board, 7, 2, enemyColor)
              && board[7][0] === 'wr') {
              pushMove({ from: { r, c }, to: { r: 7, c: 2 }, piece, castle: 'queen' });
            }
          }
          if (!inCheck && color === 'b' && r === 0 && c === 4) {
            if (chessState.castling.blackKingSide && !board[0][5] && !board[0][6]
              && !this.isChessSquareAttacked(board, 0, 5, enemyColor)
              && !this.isChessSquareAttacked(board, 0, 6, enemyColor)
              && board[0][7] === 'br') {
              pushMove({ from: { r, c }, to: { r: 0, c: 6 }, piece, castle: 'king' });
            }
            if (chessState.castling.blackQueenSide && !board[0][1] && !board[0][2] && !board[0][3]
              && !this.isChessSquareAttacked(board, 0, 3, enemyColor)
              && !this.isChessSquareAttacked(board, 0, 2, enemyColor)
              && board[0][0] === 'br') {
              pushMove({ from: { r, c }, to: { r: 0, c: 2 }, piece, castle: 'queen' });
            }
          }
        }
      }
    }
    return moves;
  }

  getLegalChessMoves(chessState, symbol) {
    const color = this.getChessColorBySymbol(symbol);
    return this.getPseudoChessMoves(chessState, symbol).filter((move) => {
      const nextState = this.cloneChessState(chessState);
      this.applyChessMove(nextState, move);
      const king = this.findChessKing(nextState.board, color);
      if (!king) return false;
      const enemyColor = color === 'w' ? 'b' : 'w';
      return !this.isChessSquareAttacked(nextState.board, king.r, king.c, enemyColor);
    });
  }

  applyChessMove(chessState, move) {
    const board = chessState.board;
    const piece = board[move.from.r][move.from.c];
    board[move.from.r][move.from.c] = null;

    if (move.enPassant) {
      const capturedRow = move.from.r;
      board[capturedRow][move.to.c] = null;
    }

    if (move.castle === 'king') {
      board[move.to.r][move.to.c] = piece;
      board[move.to.r][5] = board[move.to.r][7];
      board[move.to.r][7] = null;
    } else if (move.castle === 'queen') {
      board[move.to.r][move.to.c] = piece;
      board[move.to.r][3] = board[move.to.r][0];
      board[move.to.r][0] = null;
    } else {
      board[move.to.r][move.to.c] = move.promotion ? `${piece[0]}${move.promotion}` : piece;
    }

    chessState.enPassant = null;
    if (move.pawnDouble) {
      chessState.enPassant = { r: (move.from.r + move.to.r) / 2, c: move.from.c };
    }

    if (piece === 'wk') {
      chessState.castling.whiteKingSide = false;
      chessState.castling.whiteQueenSide = false;
    } else if (piece === 'bk') {
      chessState.castling.blackKingSide = false;
      chessState.castling.blackQueenSide = false;
    } else if (piece === 'wr' && move.from.r === 7 && move.from.c === 0) {
      chessState.castling.whiteQueenSide = false;
    } else if (piece === 'wr' && move.from.r === 7 && move.from.c === 7) {
      chessState.castling.whiteKingSide = false;
    } else if (piece === 'br' && move.from.r === 0 && move.from.c === 0) {
      chessState.castling.blackQueenSide = false;
    } else if (piece === 'br' && move.from.r === 0 && move.from.c === 7) {
      chessState.castling.blackKingSide = false;
    }

    if (move.captured === 'wr' && move.to.r === 7 && move.to.c === 0) chessState.castling.whiteQueenSide = false;
    if (move.captured === 'wr' && move.to.r === 7 && move.to.c === 7) chessState.castling.whiteKingSide = false;
    if (move.captured === 'br' && move.to.r === 0 && move.to.c === 0) chessState.castling.blackQueenSide = false;
    if (move.captured === 'br' && move.to.r === 0 && move.to.c === 7) chessState.castling.blackKingSide = false;
  }

  isChessInsufficientMaterial(board) {
    const extras = { w: [], b: [] };
    const bishops = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const type = this.getChessPieceType(piece);
        if (type === 'k') continue;
        const color = this.getChessPieceColor(piece);
        extras[color].push(type);
        if (type === 'b') {
          bishops.push({ color, squareColor: (r + c) % 2 });
        }
      }
    }

    const allExtras = [...extras.w, ...extras.b];
    if (allExtras.length === 0) return true;

    if (allExtras.some((type) => ['p', 'r', 'q'].includes(type))) return false;

    if (allExtras.length === 1 && ['b', 'n'].includes(allExtras[0])) return true;

    if (allExtras.every((type) => type === 'n')) {
      return allExtras.length <= 2;
    }

    if (allExtras.every((type) => type === 'b')) {
      const maxBishopsPerSide = Math.max(extras.w.length, extras.b.length);
      if (maxBishopsPerSide <= 1) {
        return true;
      }
      const uniqueSquareColors = new Set(bishops.map((bishop) => bishop.squareColor));
      return uniqueSquareColors.size === 1;
    }

    if (allExtras.length === 2) {
      const sorted = [...allExtras].sort().join('');
      if (sorted === 'bn') return false;
    }

    return false;
  }

  hasChessSufficientMaterialForMate(board, symbol) {
    const color = this.getChessColorBySymbol(symbol);
    const pieces = [];
    const bishops = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece || this.getChessPieceColor(piece) !== color) continue;
        const type = this.getChessPieceType(piece);
        if (type === 'k') continue;
        pieces.push(type);
        if (type === 'b') bishops.push((r + c) % 2);
      }
    }

    if (pieces.some((type) => ['p', 'r', 'q'].includes(type))) return true;
    if (pieces.filter((type) => type === 'b').length >= 2) return true;
    if (pieces.includes('b') && pieces.includes('n')) return true;
    if (pieces.filter((type) => type === 'n').length >= 3) return true;
    if (pieces.filter((type) => type === 'b').length >= 1 && new Set(bishops).size > 1) return true;
    return false;
  }

  formatChessMoveNotation(move, { inCheck = false, isMate = false } = {}) {
    if (move.castle === 'king') return `O-O${isMate ? '#' : (inCheck ? '+' : '')}`;
    if (move.castle === 'queen') return `O-O-O${isMate ? '#' : (inCheck ? '+' : '')}`;

    const pieceLetter = this.getChessPieceNotationLetter(move.piece);
    const fromSquare = this.getChessSquareName(move.from.r, move.from.c);
    const toSquare = this.getChessSquareName(move.to.r, move.to.c);
    const captureMarker = move.captured ? 'x' : '-';
    const promotionSuffix = move.promotion ? `=${String(move.promotion).toUpperCase()}` : '';
    const enPassantSuffix = move.enPassant ? ' e.p.' : '';
    const suffix = isMate ? '#' : (inCheck ? '+' : '');

    if (!pieceLetter) {
      const pawnPrefix = move.captured ? fromSquare[0] : fromSquare;
      return `${pawnPrefix}${captureMarker}${toSquare}${promotionSuffix}${enPassantSuffix}${suffix}`;
    }

    return `${pieceLetter}${fromSquare}${captureMarker}${toSquare}${promotionSuffix}${suffix}`;
  }

  buildChessMoveHistoryEntry(chessState, move, playerSlot, { inCheck = false, isMate = false } = {}) {
    const moveIndex = Number(chessState.moveHistory?.length || 0) + 1;
    return {
      index: moveIndex,
      moveNumber: Math.ceil(moveIndex / 2),
      player: playerSlot,
      color: playerSlot === 1 ? 'white' : 'black',
      notation: this.formatChessMoveNotation(move, { inCheck, isMate }),
      from: this.getChessSquareName(move.from.r, move.from.c),
      to: this.getChessSquareName(move.to.r, move.to.c),
      piece: move.piece,
      captured: move.captured || null,
      promotion: move.promotion || null,
      castle: move.castle || null,
      enPassant: move.enPassant === true,
      createdAt: Date.now()
    };
  }

  buildChessStatusMessage({ currentPlayer, inCheck = false, isMate = false, isStalemate = false, reason = null } = {}) {
    if (reason === 'threefold-repetition') return 'Nulle par triple repetition.';
    if (reason === 'fifty-move-rule') return 'Nulle par regle des 50 coups.';
    if (reason === 'insufficient-material') return 'Nulle par materiel insuffisant.';
    if (reason === 'timeout') return 'Defaite au temps.';
    if (reason === 'timeout-draw') return 'Nulle au temps, materiel insuffisant.';
    if (isMate) return 'Echec et mat.';
    if (isStalemate) return 'Pat. Match nul.';
    if (inCheck) return 'Echec.';
    return currentPlayer === 1 ? 'Traits aux Blancs' : 'Traits aux Noirs';
  }

  getChessTimeoutResultMessage(game, winnerId) {
    if (!game) return 'Defaite au temps.';
    if (winnerId === 'draw') return 'Match nul au temps.';
    return String(winnerId) === String(game.player1?.id) ? 'Victoire des Blancs au temps.' : 'Victoire des Noirs au temps.';
  }

  getChessOpponentSymbol(symbol) {
    return symbol === 1 ? 2 : 1;
  }

  countChessPieces(board) {
    let count = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]) count += 1;
      }
    }
    return count;
  }

  getChessPieceActivityScore(piece, r, c) {
    if (!piece) return 0;

    const color = this.getChessPieceColor(piece);
    const type = this.getChessPieceType(piece);
    const forwardProgress = color === 'w' ? 7 - r : r;
    const centerDistance = Math.abs(3.5 - r) + Math.abs(3.5 - c);
    const centerBonus = Math.max(0, Math.round((4 - centerDistance) * 4));
    const onEdge = r === 0 || r === 7 || c === 0 || c === 7;
    const homeRow = color === 'w' ? 7 : 0;

    if (type === 'p') return (forwardProgress * 5) + (c >= 2 && c <= 5 ? 4 : 0) + Math.round(centerBonus * 0.35);
    if (type === 'n') return centerBonus + (onEdge ? -12 : 0) + (r === homeRow ? -10 : 6);
    if (type === 'b') return Math.round(centerBonus * 0.85) + (r === homeRow ? -6 : 6);
    if (type === 'r') return Math.round(centerBonus * 0.3) + (r === homeRow ? -4 : 8);
    if (type === 'q') return Math.round(centerBonus * 0.35) + (forwardProgress > 1 ? 4 : 0);
    return 0;
  }

  evaluateChessPawnStructure(pawnFiles, color) {
    let score = 0;

    for (let file = 0; file < 8; file++) {
      const pawnsOnFile = pawnFiles[color][file];
      if (!pawnsOnFile) continue;

      if (pawnsOnFile > 1) {
        score -= (pawnsOnFile - 1) * 15;
      }

      const hasLeftSupport = file > 0 && pawnFiles[color][file - 1] > 0;
      const hasRightSupport = file < 7 && pawnFiles[color][file + 1] > 0;
      if (!hasLeftSupport && !hasRightSupport) {
        score -= 12;
      }
    }

    return score;
  }

  evaluateChessKingSafety(chessState, color, pieceCount) {
    const king = this.findChessKing(chessState.board, color);
    if (!king) return -CHESS_PIECE_VALUES.k;

    const isEndgame = pieceCount <= 12;
    if (isEndgame) {
      const centerDistance = Math.abs(3.5 - king.r) + Math.abs(3.5 - king.c);
      return Math.round((5 - centerDistance) * 9);
    }

    let score = 0;
    const homeRow = color === 'w' ? 7 : 0;
    if (king.r === homeRow && (king.c === 6 || king.c === 2)) {
      score += 42;
    } else if (king.r === homeRow && king.c === 4) {
      score -= 12;
    } else {
      score -= 24;
    }

    const shieldRow = color === 'w' ? king.r - 1 : king.r + 1;
    for (let dc = -1; dc <= 1; dc++) {
      const shieldCol = king.c + dc;
      const shieldPiece = this.isInsideChessBoard(shieldRow, shieldCol) ? chessState.board[shieldRow][shieldCol] : null;
      if (shieldPiece === `${color}p`) {
        score += 10;
      } else {
        score -= 7;
      }
    }

    if (king.c >= 3 && king.c <= 4) {
      score -= 8;
    }

    return score;
  }

  evaluateChessState(chessState, perspectiveSymbol) {
    const perspectiveColor = this.getChessColorBySymbol(perspectiveSymbol);
    const enemySymbol = this.getChessOpponentSymbol(perspectiveSymbol);
    const pieceCount = this.countChessPieces(chessState.board);
    const pawnFiles = {
      w: Array(8).fill(0),
      b: Array(8).fill(0)
    };
    const bishops = { w: 0, b: 0 };
    let score = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = chessState.board[r][c];
        if (!piece) continue;

        const color = this.getChessPieceColor(piece);
        const type = this.getChessPieceType(piece);
        const pieceScore = CHESS_PIECE_VALUES[type] + this.getChessPieceActivityScore(piece, r, c);

        if (type === 'p') pawnFiles[color][c] += 1;
        if (type === 'b') bishops[color] += 1;

        score += color === perspectiveColor ? pieceScore : -pieceScore;
      }
    }

    const perspectiveStructure = this.evaluateChessPawnStructure(pawnFiles, perspectiveColor);
    const enemyColor = this.getChessColorBySymbol(enemySymbol);
    const enemyStructure = this.evaluateChessPawnStructure(pawnFiles, enemyColor);
    score += perspectiveStructure - enemyStructure;

    if (bishops[perspectiveColor] >= 2) score += 28;
    if (bishops[enemyColor] >= 2) score -= 28;

    score += this.evaluateChessKingSafety(chessState, perspectiveColor, pieceCount);
    score -= this.evaluateChessKingSafety(chessState, enemyColor, pieceCount);

    const perspectiveMobility = this.getLegalChessMoves(chessState, perspectiveSymbol).length;
    const enemyMobility = this.getLegalChessMoves(chessState, enemySymbol).length;
    score += (perspectiveMobility - enemyMobility) * (pieceCount <= 12 ? 5 : 3);

    if (this.isChessKingInCheck(chessState.board, enemySymbol)) score += 26;
    if (this.isChessKingInCheck(chessState.board, perspectiveSymbol)) score -= 26;

    return score;
  }

  scoreChessMove(chessState, move, perspectiveSymbol = null) {
    const attackerType = this.getChessPieceType(move.piece);
    const capturedType = this.getChessPieceType(move.captured);
    let score = 0;

    if (move.captured) {
      score += (CHESS_PIECE_VALUES[capturedType] || 0) - Math.round((CHESS_PIECE_VALUES[attackerType] || 0) / 12);
    }
    if (move.promotion) score += 880;
    if (move.castle) score += 90;
    if ([2, 3, 4, 5].includes(move.to.c) && [2, 3, 4, 5].includes(move.to.r)) score += 14;
    if (attackerType === 'p') score += Math.abs(move.to.r - move.from.r) * 5;
    if (attackerType === 'n' || attackerType === 'b') score += 8;

    const nextState = this.cloneChessState(chessState);
    this.applyChessMove(nextState, move);
    const enemySymbol = move.piece[0] === 'w' ? 2 : 1;
    if (this.isChessKingInCheck(nextState.board, enemySymbol)) score += 15;
    if (perspectiveSymbol !== null) {
      score += this.getChessPieceActivityScore(nextState.board[move.to.r][move.to.c], move.to.r, move.to.c);
    }
    return score;
  }

  orderChessMoves(chessState, moves, perspectiveSymbol = null) {
    return [...moves].sort((a, b) => this.scoreChessMove(chessState, b, perspectiveSymbol) - this.scoreChessMove(chessState, a, perspectiveSymbol));
  }

  getChessBotSearchDepth(game, legalMovesCount = 0) {
    const botLevel = Math.max(1, Number(game?.player2?.level || 1));
    const isPaidMode = game?.mode === 'paid';
    const pieceCount = game?.chessState ? this.countChessPieces(game.chessState.board) : 32;

    let depth = 3;
    if (isPaidMode || botLevel >= 10 || legalMovesCount <= 16 || pieceCount <= 14) {
      depth = 4;
    }

    return depth;
  }

  searchChessPosition(chessState, currentSymbol, depth, alpha, beta, rootSymbol, ply = 0) {
    const legalMoves = this.getLegalChessMoves(chessState, currentSymbol);
    const inCheck = this.isChessKingInCheck(chessState.board, currentSymbol);

    if (!legalMoves.length) {
      if (inCheck) {
        return currentSymbol === rootSymbol
          ? (-CHESS_MATE_SCORE + ply)
          : (CHESS_MATE_SCORE - ply);
      }
      return 0;
    }

    if (depth <= 0) {
      return this.evaluateChessState(chessState, rootSymbol);
    }

    const orderedMoves = this.orderChessMoves(chessState, legalMoves, rootSymbol);
    const nextSymbol = this.getChessOpponentSymbol(currentSymbol);

    if (currentSymbol === rootSymbol) {
      let bestScore = -Infinity;
      for (const move of orderedMoves) {
        const nextState = this.cloneChessState(chessState);
        this.applyChessMove(nextState, move);
        const score = this.searchChessPosition(nextState, nextSymbol, depth - 1, alpha, beta, rootSymbol, ply + 1);
        if (score > bestScore) bestScore = score;
        if (bestScore > alpha) alpha = bestScore;
        if (alpha >= beta) break;
      }
      return bestScore;
    }

    let bestScore = Infinity;
    for (const move of orderedMoves) {
      const nextState = this.cloneChessState(chessState);
      this.applyChessMove(nextState, move);
      const score = this.searchChessPosition(nextState, nextSymbol, depth - 1, alpha, beta, rootSymbol, ply + 1);
      if (score < bestScore) bestScore = score;
      if (bestScore < beta) beta = bestScore;
      if (alpha >= beta) break;
    }
    return bestScore;
  }

  findBestChessMove(chessState, symbol, depth, precomputedMoves = null) {
    const legalMoves = Array.isArray(precomputedMoves) && precomputedMoves.length
      ? [...precomputedMoves]
      : this.getLegalChessMoves(chessState, symbol);

    if (!legalMoves.length) return null;

    const orderedMoves = this.orderChessMoves(chessState, legalMoves, symbol);
    const nextSymbol = this.getChessOpponentSymbol(symbol);
    let bestMove = orderedMoves[0];
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const move of orderedMoves) {
      const nextState = this.cloneChessState(chessState);
      this.applyChessMove(nextState, move);
      const score = this.searchChessPosition(nextState, nextSymbol, depth - 1, alpha, beta, symbol, 1);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }

      if (bestScore > alpha) alpha = bestScore;
    }

    return bestMove;
  }

  // --- TIC TAC TOE WIN AND AI ENGINE ---
  checkTicTacToeWin(board, r, c, val) {
    // Check row
    if (board[r].every(cell => cell === val)) return [[r, 0], [r, 1], [r, 2]];
    // Check column
    if (board.every(row => row[c] === val)) return [[0, c], [1, c], [2, c]];
    // Check main diagonal
    if (r === c && board[0][0] === val && board[1][1] === val && board[2][2] === val) return [[0, 0], [1, 1], [2, 2]];
    // Check anti diagonal
    if (r + c === 2 && board[0][2] === val && board[1][1] === val && board[2][0] === val) return [[0, 2], [1, 1], [2, 0]];
    return null;
  }

  getTicTacToeAIMove(board, botVal, playerVal) {
    // 1. Can bot win?
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (board[r][c] === 0) {
          board[r][c] = botVal;
          const wins = this.checkTicTacToeWin(board, r, c, botVal);
          board[r][c] = 0;
          if (wins) return { r, c };
        }
      }
    }
    // 2. Can player win? Block it!
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (board[r][c] === 0) {
          board[r][c] = playerVal;
          const wins = this.checkTicTacToeWin(board, r, c, playerVal);
          board[r][c] = 0;
          if (wins) return { r, c };
        }
      }
    }
    // 3. Play center if empty
    if (board[1][1] === 0) return { r: 1, c: 1 };
    // 4. Play corners
    const corners = [{ r: 0, c: 0 }, { r: 0, c: 2 }, { r: 2, c: 0 }, { r: 2, c: 2 }];
    const freeCorners = corners.filter(pos => board[pos.r][pos.c] === 0);
    if (freeCorners.length > 0) return freeCorners[Math.floor(Math.random() * freeCorners.length)];
    // 5. Play remaining sides
    const sides = [{ r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 2 }, { r: 2, c: 1 }];
    const freeSides = sides.filter(pos => board[pos.r][pos.c] === 0);
    if (freeSides.length > 0) return freeSides[Math.floor(Math.random() * freeSides.length)];
    return null;
  }

  // --- CONNECT FOUR WIN AND AI ENGINE ---
  checkConnectFourWin(board, r, c, val) {
    const directions = [
      { dr: 0, dc: 1 },  // horizontal
      { dr: 1, dc: 0 },  // vertical
      { dr: 1, dc: 1 },  // diagonal down-right
      { dr: 1, dc: -1 }  // diagonal down-left
    ];

    for (const { dr, dc } of directions) {
      const stones = [{ r, c }];
      // Positive
      let step = 1;
      while (true) {
        const nr = r + step * dr;
        const nc = c + step * dc;
        if (nr < 0 || nr >= 6 || nc < 0 || nc >= 7) break;
        if (board[nr][nc] === val) {
          stones.push({ r: nr, c: nc });
          step++;
        } else break;
      }
      // Negative
      step = 1;
      while (true) {
        const nr = r - step * dr;
        const nc = c - step * dc;
        if (nr < 0 || nr >= 6 || nc < 0 || nc >= 7) break;
        if (board[nr][nc] === val) {
          stones.push({ r: nr, c: nc });
          step++;
        } else break;
      }

      if (stones.length >= 4) {
        return stones;
      }
    }
    return null;
  }

  getConnectFourAIMove(board, botVal, playerVal, isPaidMode = false) {
    // Strong Connect 4 engine for all bot matches.
    // Paid mode still searches slightly deeper, but casual mode is no longer trivial.
    const colOrder = [3, 2, 4, 1, 5, 0, 6];
    const emptyCells = board.reduce((count, row) => count + row.filter((cell) => cell === 0).length, 0);
    const depthLimit = isPaidMode
      ? (emptyCells > 28 ? 8 : emptyCells > 14 ? 9 : 10)
      : (emptyCells > 28 ? 7 : emptyCells > 14 ? 8 : 9);

    const cloneBoard = (b) => b.map((row) => [...row]);

    const getDropRow = (b, col) => {
      for (let r = 5; r >= 0; r--) {
        if (b[r][col] === 0) return r;
      }
      return -1;
    };

    const getAvailableMoves = (b) => {
      const moves = [];
      for (const col of colOrder) {
        const row = getDropRow(b, col);
        if (row !== -1) moves.push({ r: row, c: col });
      }
      return moves;
    };

    const countImmediateWins = (b, val) => {
      let wins = 0;
      for (const move of getAvailableMoves(b)) {
        b[move.r][move.c] = val;
        const isWin = !!this.checkConnectFourWin(b, move.r, move.c, val);
        b[move.r][move.c] = 0;
        if (isWin) wins++;
      }
      return wins;
    };

    const getImmediateWinningMoves = (b, val) => {
      const winningMoves = [];
      for (const move of getAvailableMoves(b)) {
        b[move.r][move.c] = val;
        const isWin = !!this.checkConnectFourWin(b, move.r, move.c, val);
        b[move.r][move.c] = 0;
        if (isWin) winningMoves.push({ ...move });
      }
      return winningMoves;
    };

    const isSafePositionAfterMove = (b, oppVal) => {
      const opponentImmediateWins = countImmediateWins(b, oppVal);
      return opponentImmediateWins === 0;
    };

    for (const move of getAvailableMoves(board)) {
      board[move.r][move.c] = botVal;
      const wins = this.checkConnectFourWin(board, move.r, move.c, botVal);
      board[move.r][move.c] = 0;
      if (wins) return move;
    }

    for (const move of getAvailableMoves(board)) {
      board[move.r][move.c] = playerVal;
      const wins = this.checkConnectFourWin(board, move.r, move.c, playerVal);
      board[move.r][move.c] = 0;
      if (wins) return move;
    }

    const opponentThreats = getImmediateWinningMoves(board, playerVal);
    if (opponentThreats.length > 0) {
      const forcedBlocks = getAvailableMoves(board).filter((move) => {
        board[move.r][move.c] = botVal;
        const remainingThreats = getImmediateWinningMoves(board, playerVal);
        const isSafe = remainingThreats.length === 0;
        board[move.r][move.c] = 0;
        return isSafe;
      });

      if (forcedBlocks.length > 0) {
        return forcedBlocks[0];
      }

      // If there is no perfect block, at least play directly in one of the winning threat columns.
      const threatCols = new Set(opponentThreats.map((move) => move.c));
      const emergencyBlock = getAvailableMoves(board).find((move) => threatCols.has(move.c));
      if (emergencyBlock) return emergencyBlock;
    }

    const evaluateWindow = (window, val, oppVal) => {
      let score = 0;
      const valCount = window.filter(c => c === val).length;
      const oppCount = window.filter(c => c === oppVal).length;
      const emptyCount = window.filter(c => c === 0).length;

      if (valCount === 4) {
        score += 1000000;
      } else if (valCount === 3 && emptyCount === 1) {
        score += 12000;
      } else if (valCount === 2 && emptyCount === 2) {
        score += 600;
      } else if (valCount === 1 && emptyCount === 3) {
        score += 30;
      }

      if (oppCount === 4) {
        score -= 1000000;
      } else if (oppCount === 3 && emptyCount === 1) {
        score -= 18000;
      } else if (oppCount === 2 && emptyCount === 2) {
        score -= 900;
      } else if (oppCount === 1 && emptyCount === 3) {
        score -= 40;
      }
      return score;
    };

    const scoreBoard = (b, val, oppVal) => {
      let score = 0;
      const centerCol = 3;
      const centerCount = b.map(row => row[centerCol]).filter(c => c === val).length;
      const nearCenterCount = b.flatMap((row) => [row[2], row[4]]).filter((c) => c === val).length;
      score += centerCount * 220;
      score += nearCenterCount * 70;

      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 4; c++) {
          const window = [b[r][c], b[r][c+1], b[r][c+2], b[r][c+3]];
          score += evaluateWindow(window, val, oppVal);
        }
      }

      for (let c = 0; c < 7; c++) {
        for (let r = 0; r < 3; r++) {
          const window = [b[r][c], b[r+1][c], b[r+2][c], b[r+3][c]];
          score += evaluateWindow(window, val, oppVal);
        }
      }

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const window = [b[r][c], b[r+1][c+1], b[r+2][c+2], b[r+3][c+3]];
          score += evaluateWindow(window, val, oppVal);
        }
      }

      for (let r = 3; r < 6; r++) {
        for (let c = 0; c < 4; c++) {
          const window = [b[r][c], b[r-1][c+1], b[r-2][c+2], b[r-3][c+3]];
          score += evaluateWindow(window, val, oppVal);
        }
      }

      score += countImmediateWins(b, val) * 18000;
      score -= countImmediateWins(b, oppVal) * 22000;

      return score;
    };

    const minimax = (b, depth, alpha, beta, maximizing) => {
      const available = getAvailableMoves(b);
      if (depth === 0 || available.length === 0) {
        return { score: scoreBoard(b, botVal, playerVal) };
      }

      if (maximizing) {
        let maxEval = -Infinity;
        let bestMove = null;
        for (const move of available) {
          b[move.r][move.c] = botVal;
          if (this.checkConnectFourWin(b, move.r, move.c, botVal)) {
            b[move.r][move.c] = 0;
            return { score: 1000000 + depth, move };
          }
          if (depth >= 2 && !isSafePositionAfterMove(b, playerVal)) {
            b[move.r][move.c] = 0;
            if (!bestMove) bestMove = move;
            maxEval = Math.max(maxEval, -900000 + depth);
            alpha = Math.max(alpha, maxEval);
            if (beta <= alpha) break;
            continue;
          }
          const evaluation = minimax(b, depth - 1, alpha, beta, false).score;
          b[move.r][move.c] = 0;

          if (evaluation > maxEval) {
            maxEval = evaluation;
            bestMove = move;
          }
          alpha = Math.max(alpha, evaluation);
          if (beta <= alpha) break;
        }
        return { score: maxEval, move: bestMove };
      } else {
        let minEval = Infinity;
        let bestMove = null;
        for (const move of available) {
          b[move.r][move.c] = playerVal;
          if (this.checkConnectFourWin(b, move.r, move.c, playerVal)) {
            b[move.r][move.c] = 0;
            return { score: -1000000 - depth, move };
          }
          const evaluation = minimax(b, depth - 1, alpha, beta, true).score;
          b[move.r][move.c] = 0;

          if (evaluation < minEval) {
            minEval = evaluation;
            bestMove = move;
          }
          beta = Math.min(beta, evaluation);
          if (beta <= alpha) break;
        }
        return { score: minEval, move: bestMove };
      }
    };

    const result = minimax(cloneBoard(board), depthLimit, -Infinity, Infinity, true);
    return result.move;
  }

  // --- GOMOKU WIN AND AI ENGINE ---
  checkGomokuWin(board, r, c, val) {
    const directions = [
      { dr: 0, dc: 1 },  // horizontal
      { dr: 1, dc: 0 },  // vertical
      { dr: 1, dc: 1 },  // diagonal down-right
      { dr: 1, dc: -1 }  // diagonal down-left
    ];

    for (const { dr, dc } of directions) {
      const stones = [{ r, c }];
      // Positive
      let step = 1;
      while (true) {
        const nr = r + step * dr;
        const nc = c + step * dc;
        if (nr < 0 || nr >= 15 || nc < 0 || nc >= 15) break;
        if (board[nr][nc] === val) {
          stones.push({ r: nr, c: nc });
          step++;
        } else break;
      }
      // Negative
      step = 1;
      while (true) {
        const nr = r - step * dr;
        const nc = c - step * dc;
        if (nr < 0 || nr >= 15 || nc < 0 || nc >= 15) break;
        if (board[nr][nc] === val) {
          stones.push({ r: nr, c: nc });
          step++;
        } else break;
      }

      if (stones.length >= 5) {
        return stones;
      }
    }
    return null;
  }

  getGomokuAIMove(board, botVal, playerVal, isPaidMode = false) {
    const size = 15;
    let bestScore = -1;
    let bestMoves = [];

    // Check if board is empty
    let isEmpty = true;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] !== 0) {
          isEmpty = false;
          break;
        }
      }
    }
    if (isEmpty) {
      return { r: 7, c: 7 };
    }

    // Heuristic evaluation for each cell
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] !== 0) continue;

        let score = 0;
        const defenseMultiplier = isPaidMode ? 10.0 : 1.25;

        const directions = [
          { dr: 0, dc: 1 },
          { dr: 1, dc: 0 },
          { dr: 1, dc: 1 },
          { dr: 1, dc: -1 }
        ];

        for (const { dr, dc } of directions) {
          for (let i = 0; i < 5; i++) {
            const startR = r - i * dr;
            const startC = c - i * dc;

            let valid = true;
            let aiCount = 0;
            let playerCount = 0;

            for (let j = 0; j < 5; j++) {
              const currR = startR + j * dr;
              const currC = startC + j * dc;

              if (currR < 0 || currR >= size || currC < 0 || currC >= size) {
                valid = false;
                break;
              }

              const stone = board[currR][currC];
              if (stone === botVal) {
                aiCount++;
              } else if (stone === playerVal) {
                playerCount++;
              }
            }

            if (!valid) continue;

            if (aiCount > 0 && playerCount > 0) {
              continue;
            } else if (aiCount > 0) {
              if (aiCount === 4) score += isPaidMode ? 1000000 : 100000;
              else if (aiCount === 3) score += isPaidMode ? 50000 : 6000;
              else if (aiCount === 2) score += isPaidMode ? 5000 : 600;
              else if (aiCount === 1) score += 30;
            } else if (playerCount > 0) {
              if (playerCount === 4) score += isPaidMode ? 800000 : (40000 * defenseMultiplier);
              else if (playerCount === 3) score += isPaidMode ? 200000 : (3000 * defenseMultiplier);
              else if (playerCount === 2) score += isPaidMode ? 10000 : (300 * defenseMultiplier);
              else if (playerCount === 1) score += 15;
            } else {
              score += 2;
            }
          }
        }

        // Center bias
        const distFromCenter = Math.abs(r - 7) + Math.abs(c - 7);
        score += (14 - distFromCenter);

        if (score > bestScore) {
          bestScore = score;
          bestMoves = [{ r, c }];
        } else if (score === bestScore) {
          bestMoves.push({ r, c });
        }
      }
    }

    if (bestMoves.length > 0) {
      return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }
    return null;
  }

  hasLegalMoves(hand, leftEnd, rightEnd) {
    if (leftEnd === null || rightEnd === null) return true;
    return hand.some(tile => 
      tile[0] === leftEnd || tile[1] === leftEnd || 
      tile[0] === rightEnd || tile[1] === rightEnd
    );
  }

  async drawTile(gameId, playerId) {
    const game = this.games[gameId];
    if (!game) throw new Error('Partie introuvable.');
    if (game.status !== 'playing') throw new Error('La partie n\'est pas en cours.');

    const activePlayer = game.currentPlayer === 1 ? game.player1 : game.player2;
    if (activePlayer.id !== playerId) throw new Error('Ce n\'est pas votre tour.');

    if (game.gameType !== 'domino') throw new Error('Action non supportée pour ce jeu.');

    const hand = game.currentPlayer === 1 ? game.player1Hand : game.player2Hand;

    if (this.hasLegalMoves(hand, game.leftEnd, game.rightEnd)) {
      throw new Error('Vous avez des coups possibles. Vous ne pouvez pas piger.');
    }

    if (game.boneyard.length === 0) {
      throw new Error('La pioche est vide.');
    }

    const tile = game.boneyard.pop();
    hand.push(tile);

    return {
      success: true,
      game
    };
  }

  async passTurn(gameId, playerId) {
    const game = this.games[gameId];
    if (!game) throw new Error('Partie introuvable.');
    if (game.status !== 'playing') throw new Error('La partie n\'est pas en cours.');

    const activePlayer = game.currentPlayer === 1 ? game.player1 : game.player2;
    if (activePlayer.id !== playerId) throw new Error('Ce n\'est pas votre tour.');

    if (game.gameType !== 'domino') throw new Error('Action non supportée pour ce jeu.');

    const hand = game.currentPlayer === 1 ? game.player1Hand : game.player2Hand;

    if (this.hasLegalMoves(hand, game.leftEnd, game.rightEnd)) {
      throw new Error('Vous avez des coups possibles. Vous ne pouvez pas passer.');
    }

    if (game.boneyard.length > 0) {
      throw new Error('La pioche n\'est pas vide. Vous devez piger.');
    }

    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;

    return {
      success: true,
      game
    };
  }
}

// Singleton instances
module.exports = new GamesManager();
