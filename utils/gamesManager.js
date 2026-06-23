const db = require('../config/db');
const Bot = require('../models/Bot');

class GamesManager {
  constructor() {
    this.games = {};
    this.nextGameId = 1;
  }

  normalizeRounds(rounds) {
    const parsedRounds = parseInt(rounds, 10);
    if (!Number.isFinite(parsedRounds)) return 1;
    const clamped = Math.max(1, Math.min(7, parsedRounds));
    return clamped % 2 === 0 ? Math.max(1, clamped - 1) : clamped;
  }

  // Retrieve active games (waiting or playing)
  getLiveGames() {
    return Object.values(this.games)
      .filter(game => game.status !== 'finished' && game.status !== 'invited')
      .map(game => ({
        id: game.id,
        gameType: game.gameType,
        mode: game.mode,
        status: game.status,
        player1: game.player1,
        player2: game.player2,
        spectatorCount: game.spectators.length,
        createdAt: game.createdAt,
        startedAt: game.startedAt,
        betAmount: game.betAmount || 0,
        rounds: game.rounds || 1,
        liveMode: game.liveMode || 'free',
        livePrice: game.livePrice || 0
      }));
  }

  isUserBusy(userId) {
    if (!userId) return false;
    const numericId = parseInt(userId, 10);
    return Object.values(this.games).some(game => {
      if (game.status !== 'playing' && game.status !== 'invited') return false;
      const p1Id = parseInt(game.player1.id, 10);
      const p2Id = (game.player2 && !game.player2.isBot) ? parseInt(game.player2.id, 10) : null;
      return p1Id === numericId || p2Id === numericId;
    });
  }

  // Create a game session
  async createGame(creatorId, creatorInfo, gameType, opponentType, entryMode, opponentId = null, customBetAmount = 1.00, rounds = 1, liveMode = 'free', livePrice = 0.50) {
    if (this.isUserBusy(creatorId)) {
      throw new Error("Vous êtes déjà dans une partie ou avez une invitation en attente.");
    }

    if (gameType === 'puissance4') {
      gameType = 'connect4';
    }
    if (gameType === 'morpion') {
      gameType = 'gomoku';
    }
    if (gameType === 'echecs' || gameType === 'mathduel') {
      throw new Error('Ce jeu n est plus disponible.');
    }
    const isP2PInvite = opponentType === 'player' && opponentId && !String(opponentId).startsWith('bot_');

    if (isP2PInvite && this.isUserBusy(opponentId)) {
      throw new Error("Cet adversaire est déjà dans une partie ou a une invitation en attente.");
    }

    const isPaid = entryMode === 'paid';
    const betAmount = isPaid ? Math.max(0.10, parseFloat(customBetAmount || 1.00)) : 0;
    
    if (isPaid) {
      if (isP2PInvite) {
        // Direct invite: check BOTH players' balances, but do NOT deduct yet
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
        // Check user balance
        const [rows] = await db.query('SELECT deposit_account_balance FROM users WHERE id = ?', [creatorId]);
        const balance = rows.length > 0 ? parseFloat(rows[0].deposit_account_balance || 0) : 0;
        if (balance < betAmount) {
          throw new Error(`Solde insuffisant pour créer une partie payante (${betAmount.toFixed(2)} $ requis).`);
        }
        // Deduct entry fee
        await db.execute('UPDATE users SET deposit_account_balance = deposit_account_balance - ? WHERE id = ?', [betAmount, creatorId]);
      }
    }

    const gameId = 'game_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const normalizedRounds = this.normalizeRounds(rounds);
    
    // Initialize board/tiles based on game type
    let board = [];
    let player1Hand = [];
    let player2Hand = [];
    let boneyard = [];
    let leftEnd = null;
    let rightEnd = null;
    let table = [];
    let mathState = null;
    let tableFootballState = null;
    let chessState = null;

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
        phase: 'attack',
        attacker: 1,
        defender: 2,
        pendingShotLane: null,
        lastPlay: null
      };
    } else {
      // gomoku
      board = Array(15).fill(null).map(() => Array(15).fill(0));
    }

    let opponentInfo = null;
    if (isP2PInvite) {
      const [oppRows] = await db.query('SELECT id, username, first_name, last_name, avatar FROM users WHERE id = ?', [opponentId]);
      if (oppRows.length > 0) {
        const row = oppRows[0];
        opponentInfo = {
          id: row.id,
          username: row.username,
          name: row.first_name + ' ' + row.last_name,
          avatar: row.avatar || '/assets/avatar_placeholder.jpg',
          symbol: 2,
          isBot: false
        };
      } else {
        throw new Error('Adversaire introuvable.');
      }
    }

    const game = {
      id: gameId,
      gameType,
      mode: entryMode,
      betAmount: isPaid ? betAmount : 0,
      opponentType,
      status: isP2PInvite ? 'invited' : (opponentType === 'bot' ? 'playing' : 'waiting'),
      rounds: normalizedRounds,
      currentRound: 1,
      roundWins: { player1: 0, player2: 0 },
      liveMode: liveMode || 'free',
      livePrice: liveMode === 'paid' ? Math.max(0.10, parseFloat(livePrice || 0.50)) : 0,
      player1: {
        id: creatorId,
        username: creatorInfo.username,
        name: creatorInfo.name || (creatorInfo.first_name + ' ' + creatorInfo.last_name),
        avatar: creatorInfo.avatar || '/assets/avatar_placeholder.jpg',
        symbol: 1
      },
      player2: opponentInfo,
      board,
      player1Hand,
      player2Hand,
      boneyard,
      table,
      mathState,
      tableFootballState,
      chessState,
      leftEnd,
      rightEnd,
      currentPlayer: 1, // always player 1 goes first
      winner: null,
      spectators: [],
      createdAt: Date.now(),
      startedAt: (opponentType === 'bot') ? Date.now() : null
    };

    if (opponentType === 'bot') {
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
      game.player2 = {
        id: 'bot_' + bot.id,
        username: bot.username,
        name: bot.name,
        avatar: bot.avatar,
        symbol: 2,
        isBot: true,
        wins: bot.wins || 0
      };
    }

    this.games[gameId] = game;
    return game;
  }

  // Join a waiting game
  async joinGame(gameId, player2Id, player2Info) {
    if (this.isUserBusy(player2Id)) {
      throw new Error("Vous êtes déjà dans une partie ou avez une invitation en attente.");
    }
    const game = this.games[gameId];
    if (!game) throw new Error('Partie introuvable.');
    if (game.status !== 'waiting') throw new Error('Cette partie n\'est plus disponible.');
    if (game.player1.id === player2Id) throw new Error('Vous ne pouvez pas jouer contre vous-même.');

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

    game.player2 = {
      id: player2Id,
      username: player2Info.username,
      name: player2Info.name || (player2Info.first_name + ' ' + player2Info.last_name),
      avatar: player2Info.avatar || '/assets/avatar_placeholder.jpg',
      symbol: 2,
      isBot: false
    };
    if (game.gameType === 'domino') {
      game.player2Hand = game.boneyard.splice(0, 7);
    }
    game.status = 'playing';
    game.startedAt = Date.now();
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

    const activePlayer = game.currentPlayer === 1 ? game.player1 : game.player2;
    if (activePlayer.id !== playerId) throw new Error('Ce n\'est pas votre tour.');

    // Ensure numeric coordinates are parsed as integers to prevent string concatenation bugs
    const parsedRow = isNaN(parseInt(r, 10)) ? r : parseInt(r, 10);
    const parsedCol = isNaN(parseInt(c, 10)) ? c : parseInt(c, 10);

    // Validate and update board / table
    let moveRow = parsedRow;
    let moveCol = parsedCol;
    
    if (game.gameType === 'domino') {
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

      const fromRow = Number(parsedRow);
      const fromCol = Number(parsedCol);
      const toRow = Number(extraMove?.toR);
      const toCol = Number(extraMove?.toC);
      const promotion = String(extraMove?.promotion || 'q').toLowerCase();

      if (![fromRow, fromCol, toRow, toCol].every(Number.isInteger)) {
        throw new Error('Coup d échecs invalide.');
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

      const opponentSymbol = activePlayer.symbol === 1 ? 2 : 1;
      const opponentMoves = this.getLegalChessMoves(chessState, opponentSymbol);
      const opponentInCheck = this.isChessKingInCheck(chessState.board, opponentSymbol);

      if (opponentMoves.length === 0) {
        if (opponentInCheck) {
          return await this.endGame(gameId, activePlayer.id);
        }
        return await this.endGame(gameId, 'draw');
      }
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
      const lane = Number(parsedCol);
      if (!footballState) throw new Error('Match de football introuvable.');
      if (!Number.isInteger(lane) || lane < 0 || lane > 4) {
        throw new Error('Couloir invalide.');
      }

      if (footballState.phase === 'attack') {
        if (game.currentPlayer !== footballState.attacker) {
          throw new Error('C est au tour de l attaquant.');
        }
        footballState.pendingShotLane = lane;
        footballState.phase = 'defend';
        footballState.lastPlay = {
          type: 'aim',
          attacker: footballState.attacker,
          shotLane: lane
        };
        game.currentPlayer = footballState.defender;
        return { success: true, game };
      }

      if (footballState.phase !== 'defend') {
        throw new Error('Phase de jeu invalide.');
      }

      if (game.currentPlayer !== footballState.defender) {
        throw new Error('C est au tour du defenseur.');
      }

      const goal = lane !== footballState.pendingShotLane;
      const scoringPlayerSlot = footballState.attacker;
      if (goal) {
        footballState.scores[scoringPlayerSlot] = Number(footballState.scores[scoringPlayerSlot] || 0) + 1;
      }

      footballState.lastPlay = {
        type: 'shot',
        attacker: footballState.attacker,
        defender: footballState.defender,
        shotLane: footballState.pendingShotLane,
        blockLane: lane,
        goal
      };

      if (footballState.scores[scoringPlayerSlot] >= footballState.targetScore) {
        const winnerId = scoringPlayerSlot === 1 ? game.player1.id : game.player2.id;
        return await this.endGame(gameId, winnerId);
      }

      footballState.pendingShotLane = null;
      footballState.phase = 'attack';
      footballState.attacker = footballState.attacker === 1 ? 2 : 1;
      footballState.defender = footballState.attacker === 1 ? 2 : 1;
      game.currentPlayer = footballState.attacker;
      return { success: true, game };
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
    if (!game || game.status !== 'playing' || !game.player2.isBot) return;

    if (game.gameType === 'domino') {
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
        const scoredMoves = legalMoves.map((move) => ({
          move,
          score: this.scoreChessMove(game.chessState, move)
        })).sort((a, b) => b.score - a.score);
        const bestMove = scoredMoves[0]?.move;
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
        if (!footballState) return;
        if (footballState.phase === 'attack') {
          const weightedAttackChoices = isPaidMode ? [2, 2, 1, 3, 0, 4, 2] : [2, 1, 3, 0, 4];
          const lane = weightedAttackChoices[Math.floor(Math.random() * weightedAttackChoices.length)];
          return await this.makeMove(gameId, game.player2.id, 0, lane);
        }
        const lastShotLane = footballState.pendingShotLane;
        let blockLane = Number.isInteger(lastShotLane) ? lastShotLane : 2;
        if (Math.random() > (isPaidMode ? 0.82 : 0.65)) {
          const alternatives = [0, 1, 2, 3, 4].filter((lane) => lane !== blockLane);
          blockLane = alternatives[Math.floor(Math.random() * alternatives.length)];
        }
        return await this.makeMove(gameId, game.player2.id, 0, blockLane);
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

  // Handle Game forfeit
  async forfeitGame(gameId, forfeitingPlayerId) {
    const game = this.games[gameId];
    if (!game || game.status !== 'playing') return;

    const winnerId = game.player1.id === forfeitingPlayerId ? game.player2.id : game.player1.id;
    return await this.endGame(gameId, winnerId, null, true);
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
    } else if (game.gameType === 'connect4') {
      game.board = Array(6).fill(null).map(() => Array(7).fill(0));
    } else if (game.gameType === 'gomoku') {
      game.board = Array(15).fill(null).map(() => Array(15).fill(0));
    } else if (game.gameType === 'tablefootball') {
      game.tableFootballState = {
        scores: { 1: 0, 2: 0 },
        targetScore: 5,
        phase: 'attack',
        attacker: 1,
        defender: 2,
        pendingShotLane: null,
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
    game.currentPlayer = game.nextRoundStarter === 2 ? 2 : 1;
    game.winner = null;
    game.winningStones = null;
    game.pendingNextRound = null;
    game.nextRoundStarter = null;
  }

  startNextRound(gameId) {
    const game = this.games[gameId];
    if (!game || game.status !== 'round-transition') return null;

    game.currentRound = game.pendingNextRound || ((game.currentRound || 1) + 1);
    game.status = 'playing';
    this.resetGameForNextRound(game);
    return game;
  }

  // End game and handle payouts / rounds
  async endGame(gameId, winnerId, winningStones = null, isForfeit = false) {
    const game = this.games[gameId];
    if (!game) return;

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

        if (matchWinnerId !== 'draw') {
          const isPlayer1MatchWinner = game.player1.id === matchWinnerId;
          const winner = isPlayer1MatchWinner ? game.player1 : game.player2;
          
          if (winner && winner.isBot) {
            const botId = parseInt(String(winner.id).replace('bot_', ''), 10);
            if (botId) {
              await db.execute('UPDATE bots SET wins = wins + 1 WHERE id = ?', [botId]);
              winner.wins = (winner.wins || 0) + 1;
            }
          }
        }

        const isPaid = game.mode === 'paid';
        if (isPaid) {
          const betAmount = parseFloat(game.betAmount || 0);
          const totalPayout = betAmount * 2;
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

        return {
          success: true,
          game,
          finished: true,
          winnerId: matchWinnerId,
          winningStones,
          isForfeit: false
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

      if (winnerId !== 'draw') {
        const isPlayer1Winner = game.player1.id === winnerId;
        const winner = isPlayer1Winner ? game.player1 : game.player2;
        
        if (winner && winner.isBot) {
          const botId = parseInt(String(winner.id).replace('bot_', ''), 10);
          if (botId) {
            await db.execute('UPDATE bots SET wins = wins + 1 WHERE id = ?', [botId]);
            winner.wins = (winner.wins || 0) + 1;
          }
        }
      }

      const isPaid = game.mode === 'paid';
      if (isPaid) {
        const betAmount = parseFloat(game.betAmount || 0);
        const totalPayout = betAmount * 2;
        if (winnerId === 'draw') {
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

      return {
        success: true,
        game,
        finished: true,
        winnerId,
        winningStones,
        isForfeit
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

  createInitialChessState() {
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
    return {
      board,
      castling: {
        whiteKingSide: true,
        whiteQueenSide: true,
        blackKingSide: true,
        blackQueenSide: true
      },
      enPassant: null
    };
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
      enPassant: chessState.enPassant ? { ...chessState.enPassant } : null
    };
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

  scoreChessMove(chessState, move) {
    const values = { p: 10, n: 30, b: 32, r: 50, q: 90, k: 1000 };
    let score = 0;
    if (move.captured) score += values[this.getChessPieceType(move.captured)] || 0;
    if (move.promotion) score += 80;
    if (move.castle) score += 25;
    if ([3, 4].includes(move.to.c) && [3, 4].includes(move.to.r)) score += 6;

    const nextState = this.cloneChessState(chessState);
    this.applyChessMove(nextState, move);
    const enemySymbol = move.piece[0] === 'w' ? 2 : 1;
    if (this.isChessKingInCheck(nextState.board, enemySymbol)) score += 15;
    return score;
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
