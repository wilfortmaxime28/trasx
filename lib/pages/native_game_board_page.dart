import 'dart:async';
import 'dart:convert';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:http/http.dart' as http;
import '../services/game_socket_service.dart';
import '../widgets/connect4_board.dart';
import '../widgets/gomoku_board.dart';
import '../widgets/ludo_board.dart';
import '../widgets/table_football_board.dart';

/// Shown after the user picks a game type in the lobby.
/// Replicates the web active match layout, including the scoreboard, headers, and status bars.
class NativeGameBoardPage extends StatefulWidget {
  final int currentUserId;
  final String? currentUserAvatar;
  final String gameType;     // connect4 | gomoku
  final String opponentType; // bot | player
  final String entryMode;    // free | paid
  final double betAmount;
  final int rounds;
  final String botDifficulty; // 1 | 2 | 3
  final bool isDarkMode;
  final VoidCallback onBackToLobby;
  final int? opponentId;
  final String? gameId; // null if creating a new game, non-null if spectating/joining an existing game

  const NativeGameBoardPage({
    super.key,
    required this.currentUserId,
    this.currentUserAvatar,
    required this.gameType,
    required this.opponentType,
    required this.entryMode,
    required this.betAmount,
    required this.rounds,
    required this.botDifficulty,
    required this.isDarkMode,
    required this.onBackToLobby,
    this.opponentId,
    this.gameId,
  });

  @override
  State<NativeGameBoardPage> createState() => _NativeGameBoardPageState();
}

class _NativeGameBoardPageState extends State<NativeGameBoardPage>
    with SingleTickerProviderStateMixin {
  // ── State ────────────────────────────────────────────────────────────────
  String _phase = 'creating'; // creating | playing | over | error
  String? _errorMsg;
  String? _gameId;

  Map<String, dynamic>? _game;    // full game object from server
  Map<String, dynamic>? _lastMove;
  List<Map<String, dynamic>>? _winningStones;
  Map<String, dynamic>? _gameOverData;
  bool _modalShown = false;
  final List<Map<String, dynamic>> _comments = [];
  Map<String, dynamic>? _replyingTo;
  final List<Map<String, dynamic>> _giftAlerts = [];
  int _spectatorCount = 0;
  List<Map<String, dynamic>> _spectatorsList = [];

  final List<StreamSubscription> _subs = [];

  // Active turn ring animation
  late AnimationController _turnRingController;
  late Animation<double> _turnRingAnimation;

  // ── Init ─────────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    _turnRingController = AnimationController(
      duration: const Duration(milliseconds: 1200),
      vsync: this,
    )..repeat(reverse: true);
    _turnRingAnimation = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(parent: _turnRingController, curve: Curves.easeInOut),
    );
    _createGame();
  }

  @override
  void dispose() {
    _turnRingController.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    GameSocketService.instance.leaveRoom();
    super.dispose();
  }

  // Helper to format avatar URL safely (resolves the relative path / host exception)
  String? _formatAvatarUrl(String? avatarPath) {
    if (avatarPath == null || avatarPath.isEmpty) return null;
    if (avatarPath.startsWith('http')) return avatarPath;
    final cleanPath = avatarPath.startsWith('/') ? avatarPath : '/$avatarPath';
    return 'https://trasx.com$cleanPath';
  }

  static const _comingSoonGames = {'echecs'};

  // ── Create game via REST ─────────────────────────────────────────────────
  Future<void> _createGame() async {
    debugPrint('[GameBoard] Starting game creation for user ${widget.currentUserId} and game type ${widget.gameType}');
    if (!mounted) return;

    // Short-circuit for games not yet natively implemented
    if (_comingSoonGames.contains(widget.gameType)) {
      setState(() {
        _phase = 'playing';
      });
      return;
    }

    setState(() {
      _phase = 'creating';
      _errorMsg = null;
      _modalShown = false;
      _gameOverData = null;
      _winningStones = null;
    });

    try {
      if (widget.gameId != null) {
        _gameId = widget.gameId;
        final response = await http.get(
          Uri.parse('https://trasx.com/api/games/info/$_gameId'),
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': '${widget.currentUserId}',
          },
        ).timeout(const Duration(seconds: 15));

        debugPrint('[GameBoard Info] Server Response Code: ${response.statusCode}');
        debugPrint('[GameBoard Info] Server Response Body: ${response.body}');

        if (response.statusCode != 200) {
          throw Exception('Erreur serveur (${response.statusCode})');
        }

        final data = jsonDecode(response.body);
        if (data['success'] != true) {
          throw Exception(data['error'] ?? 'Impossible de charger les détails du match.');
        }

        _game = {
          'id': data['gameId'] ?? _gameId,
          'gameType': data['gameType'],
          'status': data['status'],
          'board': data['board'],
          'currentPlayer': data['currentPlayer'],
          'player1': data['player1'],
          'player2': data['player2'],
          'rounds': data['rounds'],
          'currentRound': data['currentRound'],
          'roundWins': data['roundWins'],
        };
      } else {
        final requestBody = jsonEncode({
          'gameType': widget.gameType,
          'opponentType': widget.opponentType,
          'entryMode': widget.entryMode,
          'betAmount': widget.betAmount,
          'rounds': widget.rounds,
          'botId': widget.botDifficulty,
          'opponentId': widget.opponentId,
        });
        debugPrint('[GameBoard] POST Request body: $requestBody');

        final response = await http.post(
          Uri.parse('https://trasx.com/api/games/create-mobile'),
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': '${widget.currentUserId}',
          },
          body: requestBody,
        ).timeout(const Duration(seconds: 15));

        debugPrint('[GameBoard] Server Response Code: ${response.statusCode}');
        debugPrint('[GameBoard] Server Response Body: ${response.body}');

        if (response.statusCode != 200) {
          throw Exception('Erreur serveur (${response.statusCode})');
        }

        final data = jsonDecode(response.body);
        if (data['success'] != true) {
          throw Exception(data['error'] ?? 'Impossible de créer la partie.');
        }

        _gameId = data['gameId'] as String;
        debugPrint('[GameBoard] Game created successfully. Game ID: $_gameId');

        _game = {
          'id': data['gameId'],
          'gameType': data['gameType'],
          'status': data['status'],
          'board': data['board'],
          'currentPlayer': data['currentPlayer'],
          'player1': data['player1'],
          'player2': data['player2'],
          'rounds': data['rounds'],
          'currentRound': data['currentRound'],
          'roundWins': data['roundWins'],
        };
      }

      // Connect socket and join room
      debugPrint('[GameBoard] Connecting socket for user ${widget.currentUserId}');
      await GameSocketService.instance.connect(userId: widget.currentUserId);
      debugPrint('[GameBoard] Socket configured. Joining room: game:$_gameId');
      GameSocketService.instance.joinRoom(_gameId!);

      _listenToSocket();

      debugPrint('[GameBoard] Done. Switching phase to playing');
      if (mounted) {
        setState(() => _phase = 'playing');
      }
    } catch (e, stackTrace) {
      debugPrint('[GameBoard] Error creating game: $e');
      debugPrint('[GameBoard] Stacktrace: $stackTrace');
      if (mounted) {
        setState(() {
          _phase = 'error';
          _errorMsg = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  // ── Forfeit game ─────────────────────────────────────────────────────────
  void _forfeitGame() {
    if (_gameId == null) return;

    final p1 = _game?['player1'];
    final p1Id = p1 is Map ? p1['id']?.toString() : null;
    final p2 = _game?['player2'];
    final p2Id = p2 is Map ? p2['id']?.toString() : null;
    final isSpectator = (p1Id != '${widget.currentUserId}' && p2Id != '${widget.currentUserId}');

    if (isSpectator) {
      GameSocketService.instance.leaveRoom();
      widget.onBackToLobby();
      return;
    }

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: widget.isDarkMode ? const Color(0xFF1E293B) : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 28),
            const SizedBox(width: 10),
            Text(
              'Déclarer forfait ?',
              style: TextStyle(
                fontFamily: 'Outfit',
                fontWeight: FontWeight.w900,
                fontSize: 18,
                color: _textPrimaryColor,
              ),
            ),
          ],
        ),
        content: Text(
          'Attention ! Quitter la partie maintenant entraînera votre abandon immédiat et vous perdrez automatiquement ce match.',
          style: TextStyle(
            color: _textSecondaryColor,
            fontSize: 14,
            height: 1.4,
          ),
        ),
        actionsPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            style: TextButton.styleFrom(
              foregroundColor: _textSecondaryColor,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            ),
            child: const Text(
              'Continuer à jouer',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              GameSocketService.instance.emitForfeit(gameId: _gameId!);
              GameSocketService.instance.leaveRoom();
              widget.onBackToLobby();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: const Text(
              'Abandonner le match',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  // ── Socket listeners ──────────────────────────────────────────────────────
  void _listenToSocket() {
    _subs.add(
      GameSocketService.instance.onGameStateUpdated.listen((data) {
        if (!mounted) return;
        final game = data['game'];
        if (game is Map) {
          setState(() {
            _game = Map<String, dynamic>.from(game);
            _lastMove = _game?['lastMove'] != null
                ? Map<String, dynamic>.from(_game!['lastMove'])
                : null;
            _winningStones = null; // clear winning on state update
          });
        }
      }),
    );

    _subs.add(
      GameSocketService.instance.onGameStarted.listen((game) {
        if (!mounted) return;
        setState(() {
          _game = Map<String, dynamic>.from(game);
          _phase = 'playing';
        });
      }),
    );

    _subs.add(
      GameSocketService.instance.onGameOver.listen((data) {
        if (!mounted) return;
        setState(() {
          _gameOverData = Map<String, dynamic>.from(data);
          _phase = 'over';
          // Apply winning stones if any
          final stones = data['winningStones'];
          if (stones is List) {
            _winningStones = stones
                .map((s) => Map<String, dynamic>.from(s))
                .toList();
          }
        });
        
        // Show the professional win/lose modal overlay!
        _showGameOverModal();
      }),
    );

    _subs.add(
      GameSocketService.instance.onRoundOver.listen((data) {
        if (!mounted) return;
        final roundWins = data['roundWins'];
        if (mounted && roundWins != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Manche terminée ! Score: ${roundWins['player1']} - ${roundWins['player2']}',
              ),
              backgroundColor: const Color(0xFF1E293B),
              duration: const Duration(seconds: 3),
            ),
          );
        }
      }),
    );

    _subs.add(
      GameSocketService.instance.onChatReceived.listen((msg) {
        if (!mounted) return;
        setState(() {
          _comments.add(msg);
        });

        // Show toast notification for comments not sent by current user
        if (msg['senderId']?.toString() != '${widget.currentUserId}') {
          ScaffoldMessenger.of(context).hideCurrentSnackBar();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Row(
                children: [
                  const Icon(Icons.comment_outlined, color: Colors.white, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${msg['senderName'] ?? 'Joueur'}: ${msg['content'] ?? ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
              backgroundColor: const Color(0xFF1E293B),
              duration: const Duration(seconds: 3),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          );
        }
      }),
    );

    _subs.add(
      GameSocketService.instance.onChatLiked.listen((data) {
        if (!mounted) return;
        final messageId = data['messageId'];
        final likerId = data['likerId'];
        if (messageId == null || likerId == null) return;
        setState(() {
          for (var msg in _comments) {
            if (msg['id'] == messageId) {
              final likesList = List<int>.from(msg['likes'] ?? []);
              if (likesList.contains(likerId)) {
                likesList.remove(likerId);
              } else {
                likesList.add(likerId);
              }
              msg['likes'] = likesList;
              break;
            }
          }
        });
      }),
    );

    _subs.add(
      GameSocketService.instance.onGiftBroadcast.listen((data) {
        if (!mounted) return;
        final alert = {
          'id': DateTime.now().microsecondsSinceEpoch.toString(),
          'senderName': data['senderName'] ?? 'Un spectateur',
          'recipientName': data['recipientName'] ?? 'un joueur',
          'amount': data['amount'] ?? 0.0,
        };
        setState(() {
          _giftAlerts.add(alert);
        });
        // Auto-remove after 4 seconds
        Future.delayed(const Duration(seconds: 4), () {
          if (!mounted) return;
          setState(() {
            _giftAlerts.removeWhere((a) => a['id'] == alert['id']);
          });
        });
      }),
    );

    _subs.add(
      GameSocketService.instance.onSpectatorsUpdated.listen((data) {
        if (!mounted) return;
        final count = data['count'] ?? 0;
        final list = data['spectators'];
        setState(() {
          _spectatorCount = count;
          if (list is List) {
            _spectatorsList = list.map((s) => Map<String, dynamic>.from(s)).toList();
          }
        });
      }),
    );

    _subs.add(
      GameSocketService.instance.onSpectatorJoined.listen((data) {
        if (!mounted) return;
        final message = data['message'] ?? 'Un spectateur a rejoint la salle.';
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.visibility_rounded, color: Colors.white, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    message,
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            backgroundColor: const Color(0xFF1E293B),
            duration: const Duration(seconds: 3),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        );
      }),
    );
  }

  // ── Emit move ─────────────────────────────────────────────────────────────
  void _onConnect4ColTap(int col) {
    if (_gameId == null) return;
    GameSocketService.instance.emitMove(
      gameId: _gameId!,
      r: null,
      c: col,
    );
  }

  void _onGomokuCellTap(int row, int col) {
    if (_gameId == null) return;
    GameSocketService.instance.emitMove(
      gameId: _gameId!,
      r: row,
      c: col,
    );
  }

  // ── Game Over Modal ───────────────────────────────────────────────────────
  void _showGameOverModal() {
    if (_modalShown) return;
    _modalShown = true;

    final p1 = _game?['player1'];
    final p1Name = p1 is Map ? (p1['username']?.toString() ?? 'Joueur 1') : 'Joueur 1';
    final p1Id = p1 is Map ? p1['id']?.toString() : null;

    final p2 = _game?['player2'];
    final p2Name = p2 is Map ? (p2['username']?.toString() ?? 'Joueur 2') : 'Joueur 2';
    final p2Id = p2 is Map ? p2['id']?.toString() : null;

    final isSpectator = (p1Id != '${widget.currentUserId}' && p2Id != '${widget.currentUserId}');

    final winnerId = _gameOverData?['winnerId'];
    final isWin = winnerId != null && winnerId.toString() == '${widget.currentUserId}';
    final isDraw = winnerId == null || winnerId == 'draw';

    Color headerColor;
    String title;
    String subtitle;
    IconData mainIcon;

    if (isSpectator) {
      if (isDraw) {
        headerColor = const Color(0xFF64748B);
        title = 'PARTIE TERMINÉE';
        subtitle = 'Le match s\'est terminé sur un score nul.';
        mainIcon = Icons.handshake_rounded;
      } else {
        final winnerName = (winnerId.toString() == p1Id) ? p1Name : p2Name;
        headerColor = const Color(0xFF10B981);
        title = 'VICTOIRE !';
        subtitle = '$winnerName a remporté la partie !';
        mainIcon = Icons.emoji_events_rounded;
      }
    } else {
      headerColor = isWin
          ? const Color(0xFF10B981) // Green
          : isDraw
              ? const Color(0xFF64748B) // Slate grey
              : const Color(0xFFEF4444); // Red

      title = isWin
          ? 'FÉLICITATIONS !'
          : isDraw
              ? 'MATCH NUL'
              : 'DOMMAGE…';
          
      subtitle = isWin
          ? 'Vous avez remporté la victoire avec brio !'
          : isDraw
              ? 'Une belle partie ! Aucun vainqueur pour le moment.'
              : 'Votre adversaire a gagné cette manche. Relevez le défi !';

      mainIcon = isWin
          ? Icons.emoji_events_rounded
          : isDraw
              ? Icons.handshake_rounded
              : Icons.sentiment_dissatisfied_rounded;
    }

    final roundWinsSource = _gameOverData?['roundWins'] ?? _game?['roundWins'];
    int p1Wins = 0;
    int p2Wins = 0;
    
    if (roundWinsSource != null) {
      p1Wins = roundWinsSource['player1'] ?? 0;
      p2Wins = roundWinsSource['player2'] ?? 0;
    }

    // Dynamic score fallback if roundWins is 0 - 0 but winner is resolved
    if (p1Wins == 0 && p2Wins == 0 && !isDraw && winnerId != null) {
      if (winnerId.toString() == p1Id) {
        p1Wins = 1;
        p2Wins = 0;
      } else {
        p1Wins = 0;
        p2Wins = 1;
      }
    }

    final int mySlot = (p1Id == '${widget.currentUserId}') ? 1 : 2;
    final int leftScore = isSpectator ? p1Wins : (mySlot == 1 ? p1Wins : p2Wins);
    final int rightScore = isSpectator ? p2Wins : (mySlot == 1 ? p2Wins : p1Wins);
    final String leftLabel = isSpectator ? p1Name : 'Vous';
    final String rightLabel = isSpectator ? p2Name : 'Adversaire';
    final Color leftColor = isSpectator ? const Color(0xFFEF4444) : _primaryColor;
    final Color rightColor = isSpectator ? const Color(0xFF3B82F6) : const Color(0xFFEC4899);

    showGeneralDialog(
      context: context,
      barrierDismissible: false,
      barrierLabel: 'GameOver',
      barrierColor: Colors.black.withOpacity(0.65),
      transitionDuration: const Duration(milliseconds: 350),
      pageBuilder: (context, anim1, anim2) {
        return const SizedBox.shrink(); // unused
      },
      transitionBuilder: (context, anim1, anim2, child) {
        final curveValue = Curves.easeInOutBack.transform(anim1.value);
        return Transform.scale(
          scale: curveValue,
          child: Opacity(
            opacity: anim1.value,
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
              child: Dialog(
                backgroundColor: Colors.transparent,
                insetPadding: const EdgeInsets.symmetric(horizontal: 24),
                child: Container(
                  decoration: BoxDecoration(
                    color: widget.isDarkMode ? const Color(0xEC0F172A) : const Color(0xFCEFEEFA),
                    borderRadius: BorderRadius.circular(32),
                    border: Border.all(color: headerColor.withOpacity(0.2), width: 1.5),
                    boxShadow: [
                      BoxShadow(
                        color: headerColor.withOpacity(0.1),
                        blurRadius: 30,
                        spreadRadius: 5,
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Header Glow Icon
                      Container(
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(
                          color: headerColor.withOpacity(0.12),
                          shape: BoxShape.circle,
                        ),
                        margin: const EdgeInsets.only(top: 28, bottom: 16),
                        child: Icon(
                          mainIcon,
                          size: 72,
                          color: headerColor,
                        ),
                      ),
                      
                      Text(
                        title,
                        style: TextStyle(
                          fontFamily: 'Outfit',
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                          color: _textPrimaryColor,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Text(
                          subtitle,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            color: _textSecondaryColor,
                            fontWeight: FontWeight.w600,
                            height: 1.35,
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),

                      // Professional Scoreboard Card
                      Container(
                        margin: const EdgeInsets.symmetric(horizontal: 24),
                        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
                        decoration: BoxDecoration(
                          color: widget.isDarkMode
                              ? const Color(0xFF1E293B).withOpacity(0.6)
                              : Colors.white.withOpacity(0.8),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: _borderColor),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            Column(
                              children: [
                                Text(
                                  leftLabel,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 13,
                                    color: _textPrimaryColor,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  '$leftScore',
                                  style: TextStyle(
                                    fontFamily: 'Outfit',
                                    fontSize: 36,
                                    fontWeight: FontWeight.w900,
                                    color: leftColor,
                                  ),
                                ),
                              ],
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: headerColor.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                'SCORE',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w900,
                                  color: headerColor,
                                  letterSpacing: 1.0,
                                ),
                              ),
                            ),
                            Column(
                              children: [
                                Text(
                                  rightLabel,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 13,
                                    color: _textPrimaryColor,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  '$rightScore',
                                  style: TextStyle(
                                    fontFamily: 'Outfit',
                                    fontSize: 36,
                                    fontWeight: FontWeight.w900,
                                    color: rightColor,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 28),

                      // Actions
                      Padding(
                        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                        child: Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () {
                                  Navigator.pop(context); // Close modal, letting user see the board
                                },
                                style: OutlinedButton.styleFrom(
                                  side: BorderSide(color: _borderColor),
                                  padding: const EdgeInsets.symmetric(vertical: 14),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                ),
                                child: Text(
                                  'Voir le plateau',
                                  style: TextStyle(
                                    color: _textPrimaryColor,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                    fontFamily: 'Outfit',
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Container(
                                decoration: BoxDecoration(
                                  gradient: const LinearGradient(
                                    colors: [
                                      Color(0xFFE536DB),
                                      Color(0xFF673DE6),
                                      Color(0xFF3AB0FF),
                                    ],
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                  ),
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                child: ElevatedButton(
                                  onPressed: () {
                                    Navigator.pop(context); // Close modal
                                    widget.onBackToLobby(); // Return to lobby
                                  },
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.transparent,
                                    foregroundColor: Colors.white,
                                    shadowColor: Colors.transparent,
                                    elevation: 0,
                                    padding: const EdgeInsets.symmetric(vertical: 14),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(16),
                                    ),
                                  ),
                                  child: const Text(
                                    'Quitter',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14,
                                      fontFamily: 'Outfit',
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  void _showCommentsSheet() {
    final textController = TextEditingController();
    bool showEmojiPicker = false;
    
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return SafeArea(
          child: StatefulBuilder(
            builder: (context, setModalState) {
              return Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Container(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(context).size.height * 0.65,
                  ),
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Pull bar
                      Center(
                        child: Container(
                          width: 40,
                          height: 4,
                          decoration: BoxDecoration(
                            color: _borderColor,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Commentaires en direct',
                        style: TextStyle(
                          fontFamily: 'Outfit',
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                          color: _textPrimaryColor,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Divider(color: _borderColor),
                      // Comments list
                      Expanded(
                        child: StreamBuilder<Map<String, dynamic>>(
                          stream: GameSocketService.instance.onChatReceived,
                          builder: (context, snapshot) {
                            if (_comments.isEmpty) {
                              return Center(
                                child: Text(
                                  'Aucun commentaire. Soyez le premier !',
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: _textSecondaryColor,
                                  ),
                                ),
                              );
                            }
                            return ListView.builder(
                              itemCount: _comments.length,
                              itemBuilder: (context, index) {
                                final msg = _comments[index];
                                final isSystem = msg['isSystem'] == true;
                                final messageId = msg['id'] ?? '';
                                final senderName = msg['senderName'] ?? 'Joueur';
                                final avatar = _formatAvatarUrl(msg['avatar']);
                                final content = msg['content'] ?? '';
                                final time = msg['time'] ?? '';

                                // Liking details
                                final likesList = List<int>.from(msg['likes'] ?? []);
                                final hasLiked = likesList.contains(widget.currentUserId);
                                final likesCount = likesList.length;

                                if (isSystem) {
                                  return Container(
                                    margin: const EdgeInsets.symmetric(vertical: 6),
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: _primaryLightColor,
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: Text(
                                      content,
                                      style: TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w600,
                                        color: _primaryColor,
                                      ),
                                    ),
                                  );
                                }

                                return Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 8.0),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      // Avatar
                                      Container(
                                        width: 32,
                                        height: 32,
                                        decoration: const BoxDecoration(
                                          shape: BoxShape.circle,
                                        ),
                                        child: ClipOval(
                                          child: avatar != null && avatar.isNotEmpty
                                              ? Image.network(
                                                  avatar,
                                                  fit: BoxFit.cover,
                                                  errorBuilder: (context, error, stackTrace) =>
                                                      _buildFallbackAvatar(senderName, _primaryColor),
                                                )
                                              : _buildFallbackAvatar(senderName, _primaryColor),
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      // Content & reply tree
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Row(
                                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                              children: [
                                                Text(
                                                  senderName,
                                                  style: TextStyle(
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 12.5,
                                                    color: _textPrimaryColor,
                                                  ),
                                                ),
                                                Text(
                                                  time,
                                                  style: TextStyle(
                                                    fontSize: 10,
                                                    color: _textSecondaryColor,
                                                  ),
                                                ),
                                              ],
                                            ),
                                            
                                            // Reply box if it's a thread reply
                                            if (msg['parentId'] != null)
                                              Container(
                                                margin: const EdgeInsets.only(top: 4, bottom: 4),
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                                decoration: BoxDecoration(
                                                  color: widget.isDarkMode
                                                      ? Colors.white.withOpacity(0.05)
                                                      : Colors.black.withOpacity(0.03),
                                                  borderRadius: BorderRadius.circular(6),
                                                  border: const Border(
                                                    left: BorderSide(
                                                      color: Color(0xFF8B5CF6),
                                                      width: 2.5,
                                                    ),
                                                  ),
                                                ),
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Text(
                                                      '@${msg['parentUsername'] ?? 'Joueur'}',
                                                      style: const TextStyle(
                                                        fontSize: 10.5,
                                                        fontWeight: FontWeight.bold,
                                                        color: Color(0xFF8B5CF6),
                                                      ),
                                                    ),
                                                    const SizedBox(height: 2),
                                                    Text(
                                                      msg['parentContent'] ?? '',
                                                      maxLines: 1,
                                                      overflow: TextOverflow.ellipsis,
                                                      style: TextStyle(
                                                        fontSize: 11,
                                                        color: _textSecondaryColor,
                                                        fontStyle: FontStyle.italic,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                            
                                            const SizedBox(height: 3),
                                            Text(
                                              content,
                                              style: TextStyle(
                                                fontSize: 13,
                                                color: _textPrimaryColor,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                            
                                            // Like & Reply actions row
                                            Row(
                                              children: [
                                                // Reply button
                                                TextButton(
                                                  onPressed: () {
                                                    setModalState(() {
                                                      _replyingTo = msg;
                                                    });
                                                  },
                                                  style: TextButton.styleFrom(
                                                    padding: EdgeInsets.zero,
                                                    minimumSize: const Size(40, 20),
                                                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                                  ),
                                                  child: Text(
                                                    'Répondre',
                                                    style: TextStyle(
                                                      fontSize: 11,
                                                      color: _primaryColor,
                                                      fontWeight: FontWeight.bold,
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ],
                                        ),
                                      ),
                                      // Like button on the right
                                      Column(
                                        children: [
                                          IconButton(
                                            icon: Icon(
                                              hasLiked ? Icons.favorite : Icons.favorite_border_rounded,
                                              color: hasLiked ? Colors.redAccent : _textSecondaryColor,
                                              size: 18,
                                            ),
                                            padding: EdgeInsets.zero,
                                            constraints: const BoxConstraints(),
                                            onPressed: () {
                                              if (_gameId != null && messageId.isNotEmpty) {
                                                GameSocketService.instance.likeChatMessage(
                                                  gameId: _gameId!,
                                                  messageId: messageId,
                                                );
                                              }
                                            },
                                          ),
                                          if (likesCount > 0)
                                            Text(
                                              '$likesCount',
                                              style: TextStyle(
                                                fontSize: 10,
                                                color: _textSecondaryColor,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                        ],
                                      ),
                                    ],
                                  ),
                                );
                              },
                            );
                          }
                        ),
                      ),
                      // Replying preview bar
                      if (_replyingTo != null)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: widget.isDarkMode
                                ? const Color(0xFF1E293B)
                                : const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          margin: const EdgeInsets.only(bottom: 8),
                          child: Row(
                            children: [
                              const Icon(Icons.reply, size: 16, color: Color(0xFF8B5CF6)),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Réponse à @${_replyingTo!['senderUsername'] ?? 'Joueur'} : ${_replyingTo!['content']}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: _textSecondaryColor,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.close, size: 16),
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(),
                                onPressed: () {
                                  setModalState(() {
                                    _replyingTo = null;
                                  });
                                },
                              ),
                            ],
                          ),
                        ),
                      const SizedBox(height: 8),
                      // Input row
                      Row(
                        children: [
                          IconButton(
                            icon: Icon(
                              showEmojiPicker
                                  ? Icons.keyboard_rounded
                                  : Icons.emoji_emotions_outlined,
                              color: _primaryColor,
                            ),
                            onPressed: () {
                              if (!showEmojiPicker) {
                                FocusScope.of(context).unfocus();
                              }
                              setModalState(() {
                                showEmojiPicker = !showEmojiPicker;
                              });
                            },
                          ),
                          Expanded(
                            child: TextField(
                              controller: textController,
                              style: TextStyle(color: _textPrimaryColor, fontSize: 14),
                              onTap: () {
                                setModalState(() {
                                  showEmojiPicker = false;
                                });
                              },
                              decoration: InputDecoration(
                                hintText: 'Écrire un commentaire...',
                                hintStyle: TextStyle(color: _textSecondaryColor),
                                fillColor: widget.isDarkMode
                                    ? const Color(0xFF1E293B)
                                    : const Color(0xFFF1F5F9),
                                filled: true,
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                  vertical: 12,
                                ),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(24),
                                  borderSide: BorderSide.none,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            icon: Icon(Icons.send_rounded, color: _primaryColor),
                            onPressed: () {
                              final text = textController.text.trim();
                              if (text.isEmpty || _gameId == null) return;
                              
                              GameSocketService.instance.sendChatMessage(
                                gameId: _gameId!,
                                content: text,
                                parentId: _replyingTo?['id'],
                                parentUsername: _replyingTo?['senderUsername'],
                                parentContent: _replyingTo?['content'],
                              );
                              textController.clear();
                              _replyingTo = null;
                              setModalState(() {});
                            },
                          ),
                        ],
                      ),
                      // Emoji Picker drawer
                      if (showEmojiPicker)
                        Container(
                          margin: const EdgeInsets.only(top: 8),
                          height: 200,
                          child: EmojiPicker(
                            textEditingController: textController,
                            config: Config(
                              height: 200,
                              checkPlatformCompatibility: true,
                              emojiViewConfig: EmojiViewConfig(
                                columns: 8,
                                emojiSizeMax: 28,
                                backgroundColor: widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white,
                              ),
                              categoryViewConfig: CategoryViewConfig(
                                backgroundColor: widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white,
                                indicatorColor: _primaryColor,
                                iconColor: _textSecondaryColor,
                                iconColorSelected: _primaryColor,
                                backspaceColor: _primaryColor,
                              ),
                              bottomActionBarConfig: const BottomActionBarConfig(
                                enabled: false,
                              ),
                              searchViewConfig: SearchViewConfig(
                                backgroundColor: widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white,
                                buttonIconColor: _textSecondaryColor,
                                hintText: 'Rechercher',
                                hintTextStyle: TextStyle(color: _textSecondaryColor),
                                inputTextStyle: TextStyle(
                                  color: _textPrimaryColor,
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  void _showSpectatorsListModal() {
    showModalBottomSheet(
      context: context,
      backgroundColor: widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return SafeArea(
          child: StatefulBuilder(
            builder: (context, setModalState) {
              return Container(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Pull bar
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: _borderColor,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Spectateurs en direct ($_spectatorCount)',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: 'Outfit',
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        color: _textPrimaryColor,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Divider(color: _borderColor),
                    const SizedBox(height: 8),
                    Expanded(
                      child: _spectatorsList.isEmpty
                          ? Center(
                              child: Text(
                                'Aucun spectateur pour le moment.',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: _textSecondaryColor,
                                ),
                              ),
                            )
                          : ListView.builder(
                              itemCount: _spectatorsList.length,
                              itemBuilder: (context, index) {
                                final spectator = _spectatorsList[index];
                                final name = spectator['first_name'] != null || spectator['last_name'] != null
                                    ? '${spectator['first_name'] ?? ''} ${spectator['last_name'] ?? ''}'.trim()
                                    : spectator['username'] ?? 'Spectateur';
                                final avatar = _formatAvatarUrl(spectator['avatar']?.toString());
                                return ListTile(
                                  leading: CircleAvatar(
                                    radius: 16,
                                    backgroundImage: avatar != null && avatar.isNotEmpty
                                        ? NetworkImage(avatar)
                                        : null,
                                    child: avatar == null || avatar.isEmpty
                                        ? Text(name.substring(0, 1).toUpperCase())
                                        : null,
                                  ),
                                  title: Text(
                                    name,
                                    style: TextStyle(
                                      color: _textPrimaryColor,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14,
                                    ),
                                  ),
                                  subtitle: Text(
                                    '@${spectator['username'] ?? ''}',
                                    style: TextStyle(
                                      color: _textSecondaryColor,
                                      fontSize: 12,
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );
  }

  void _showGiftModal() {
    if (_gameId == null) return;
    
    final me = _me;
    final opp = _opponent;
    
    if (me == null || opp == null) return;
    
    // Available recipients to send a gift to
    final recipients = [
      {
        'id': me['id'],
        'name': me['first_name'] != null || me['last_name'] != null
            ? '${me['first_name'] ?? ''} ${me['last_name'] ?? ''}'.trim()
            : me['username'] ?? 'Vous',
        'avatar': me['avatar'],
        'isMe': true,
      },
      {
        'id': opp['id'],
        'name': opp['first_name'] != null || opp['last_name'] != null
            ? '${opp['first_name'] ?? ''} ${opp['last_name'] ?? ''}'.trim()
            : opp['username'] ?? 'Adversaire',
        'avatar': opp['avatar'],
        'isMe': false,
      }
    ];

    // Selected recipient
    Map<String, dynamic> selectedRecipient = recipients[1]; // Opponent is default

    final presets = [
      {'emoji': '🌹', 'name': 'Rose', 'price': 1.0},
      {'emoji': '☕', 'name': 'Café', 'price': 2.0},
      {'emoji': '👑', 'name': 'Couronne', 'price': 5.0},
      {'emoji': '🚀', 'name': 'Fusée', 'price': 10.0},
      {'emoji': '🎯', 'name': 'Projecteur', 'price': 20.0},
      {'emoji': '🔥', 'name': 'Flamme', 'price': 30.0},
      {'emoji': '💎', 'name': 'Diamant', 'price': 50.0},
      {'emoji': '🦄', 'name': 'Licorne', 'price': 100.0},
      {'emoji': '🦁', 'name': 'Lion', 'price': 200.0},
      {'emoji': '🌌', 'name': 'Univers TrasX', 'price': 500.0},
    ];

    Map<String, dynamic> selectedPreset = presets[0];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return SafeArea(
          child: StatefulBuilder(
            builder: (context, setModalState) {
              return Container(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Pull bar
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: _borderColor,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Envoyer un cadeau',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: 'Outfit',
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                        color: _textPrimaryColor,
                      ),
                    ),
                    const SizedBox(height: 16),
                    
                    // Recipient Selector
                    Text(
                      'Envoyer à :',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: _textSecondaryColor,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: recipients.map((r) {
                        final isSelected = selectedRecipient['id'] == r['id'];
                        return Expanded(
                          child: GestureDetector(
                            onTap: () {
                              setModalState(() {
                                selectedRecipient = r;
                              });
                            },
                            child: Container(
                              margin: const EdgeInsets.symmetric(horizontal: 4),
                              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? _primaryColor.withOpacity(0.12)
                                    : (widget.isDarkMode ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9)),
                                border: Border.all(
                                  color: isSelected ? _primaryColor : _borderColor,
                                  width: 1.5,
                                ),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 14,
                                    backgroundImage: r['avatar'] != null && r['avatar'].toString().isNotEmpty
                                        ? NetworkImage(_formatAvatarUrl(r['avatar'].toString())!)
                                        : null,
                                    child: r['avatar'] == null || r['avatar'].toString().isEmpty
                                        ? Text(r['name'].toString().substring(0, 1).toUpperCase())
                                        : null,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      r['name'].toString(),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                        color: isSelected ? _primaryColor : _textPrimaryColor,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 16),
                    
                    // Grid of TikTok presets
                    Container(
                      height: 180,
                      child: GridView.builder(
                        scrollDirection: Axis.horizontal,
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          mainAxisSpacing: 10,
                          crossAxisSpacing: 10,
                          childAspectRatio: 1.1,
                        ),
                        itemCount: presets.length,
                        itemBuilder: (context, index) {
                          final p = presets[index];
                          final isSelected = selectedPreset['name'] == p['name'];
                          return GestureDetector(
                            onTap: () {
                              setModalState(() {
                                selectedPreset = p;
                              });
                            },
                            child: Container(
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? _primaryColor.withOpacity(0.12)
                                    : (widget.isDarkMode ? const Color(0xFF1E293B).withOpacity(0.5) : const Color(0xFFF8FAFC)),
                                border: Border.all(
                                  color: isSelected ? _primaryColor : _borderColor,
                                  width: 1.5,
                                ),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(
                                    p['emoji'] as String,
                                    style: const TextStyle(fontSize: 26),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    p['name'] as String,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                      color: _textPrimaryColor,
                                    ),
                                  ),
                                  Text(
                                    '${(p['price'] as double).toStringAsFixed(0)} \$',
                                    style: TextStyle(
                                      fontSize: 10,
                                      color: _primaryColor,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 20),
                    
                    // Send Button
                    ElevatedButton(
                      onPressed: () {
                        final recipientId = int.tryParse(selectedRecipient['id'].toString());
                        if (recipientId == null) return;
                        
                        GameSocketService.instance.sendGameGift(
                          gameId: _gameId!,
                          recipientId: recipientId,
                          amount: selectedPreset['price'] as double,
                        );
                        
                        Navigator.pop(context);
                        
                        // Show quick confirmation SnackBar
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              'Cadeau ${selectedPreset['name']} envoyé à ${selectedRecipient['name']} !',
                              style: const TextStyle(fontWeight: FontWeight.bold),
                            ),
                            backgroundColor: _primaryColor,
                            duration: const Duration(seconds: 2),
                          ),
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _primaryColor,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      child: Text(
                        'Envoyer ${selectedPreset['emoji']} (${(selectedPreset['price'] as double).toStringAsFixed(0)} \$)',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontFamily: 'Outfit',
                          fontSize: 15,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildGiftAlertWidget(Map<String, dynamic> alert) {
    final sender = alert['senderName'];
    final recipient = alert['recipientName'];
    final double amount = (alert['amount'] ?? 0.0).toDouble();

    // Map amount to gift details
    String giftEmoji = '🎁';
    String giftName = 'Cadeau';
    if (amount <= 1.0) { giftEmoji = '🌹'; giftName = 'Rose'; }
    else if (amount <= 2.0) { giftEmoji = '☕'; giftName = 'Café'; }
    else if (amount <= 5.0) { giftEmoji = '👑'; giftName = 'Couronne'; }
    else if (amount <= 10.0) { giftEmoji = '🚀'; giftName = 'Fusée'; }
    else if (amount <= 20.0) { giftEmoji = '🎯'; giftName = 'Projecteur'; }
    else if (amount <= 30.0) { giftEmoji = '🔥'; giftName = 'Flamme'; }
    else if (amount <= 50.0) { giftEmoji = '💎'; giftName = 'Diamant'; }
    else if (amount <= 100.0) { giftEmoji = '🦄'; giftName = 'Licorne'; }
    else if (amount <= 200.0) { giftEmoji = '🦁'; giftName = 'Lion'; }
    else { giftEmoji = '🌌'; giftName = 'Univers TrasX'; }

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 24),
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 18),
      decoration: BoxDecoration(
        color: widget.isDarkMode ? const Color(0xEE1E293B) : const Color(0xEEF8FAFC),
        borderRadius: BorderRadius.circular(30),
        border: Border.all(color: _primaryColor.withOpacity(0.3), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: _primaryColor.withOpacity(0.15),
            blurRadius: 10,
            spreadRadius: 1,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            giftEmoji,
            style: const TextStyle(fontSize: 22),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              '$sender a envoyé $giftName à $recipient !',
              style: TextStyle(
                color: _textPrimaryColor,
                fontWeight: FontWeight.bold,
                fontSize: 13,
                fontFamily: 'Outfit',
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  int get _mySymbol {
    final g = _game;
    if (g == null) return 1;
    final p1 = g['player1'];
    if (p1 is Map && p1['id']?.toString() == '${widget.currentUserId}') {
      return p1['symbol'] ?? 1;
    }
    final p2 = g['player2'];
    if (p2 is Map && p2['id']?.toString() == '${widget.currentUserId}') {
      return p2['symbol'] ?? 2;
    }
    return 1;
  }

  int get _currentPlayerSymbol {
    return _game?['currentPlayer'] ?? 1;
  }

  bool get _myTurn => _currentPlayerSymbol == _mySymbol;

  String get _turnLabel {
    if (_phase == 'over') return _gameOverLabel;
    if (_myTurn) return "C'est à votre tour";
    return "Tour de l'adversaire…";
  }

  String get _gameOverLabel {
    final data = _gameOverData;
    if (data == null) return 'Partie terminée';
    final winnerId = data['winnerId'];
    if (winnerId == null || winnerId == 'draw') return 'Match nul !';
    if (winnerId.toString() == '${widget.currentUserId}') return 'Victoire !';
    return 'Défaite…';
  }

  Color get _primaryColor => const Color(0xFF673DE6);
  Color get _primaryLightColor => const Color(0x1F673DE6);
  Color get _cardBgColor => widget.isDarkMode ? const Color(0xFF0F0F0F) : const Color(0xFFF9F9F9);
  Color get _borderColor => widget.isDarkMode ? Colors.white.withOpacity(0.1) : Colors.black.withOpacity(0.1);
  Color get _textPrimaryColor => widget.isDarkMode ? Colors.white : Colors.black;
  Color get _textSecondaryColor => widget.isDarkMode ? Colors.white60 : Colors.black54;

  Map<String, dynamic>? get _opponent {
    final g = _game;
    if (g == null) return null;
    final p1 = g['player1'];
    if (p1 is Map && p1['id']?.toString() == '${widget.currentUserId}') {
      return g['player2'] is Map ? Map<String, dynamic>.from(g['player2']) : null;
    }
    return p1 is Map ? Map<String, dynamic>.from(p1) : null;
  }

  Map<String, dynamic>? get _me {
    final g = _game;
    if (g == null) return null;
    final p1 = g['player1'];
    if (p1 is Map && p1['id']?.toString() == '${widget.currentUserId}') {
      return Map<String, dynamic>.from(p1);
    }
    return g['player2'] is Map ? Map<String, dynamic>.from(g['player2']) : null;
  }

  List<List<int>> get _board {
    final raw = _game?['board'];
    if (raw is List) {
      return raw
          .map<List<int>>((row) => (row as List).map<int>((c) => (c ?? 0) as int).toList())
          .toList();
    }
    // Default empty board
    if (widget.gameType == 'connect4') {
      return List.generate(6, (_) => List.generate(7, (_) => 0));
    }
    return List.generate(15, (_) => List.generate(15, (_) => 0));
  }

  @override
  Widget build(BuildContext context) {
    final isDark = widget.isDarkMode;
    final bg = isDark ? Colors.black : Colors.white;
    final showAppBar = _phase == 'playing' || _phase == 'over';
    final Map<String, String> gameTitles = {
      'connect4': 'Puissance 4',
      'gomoku': 'Gomoku',
      'ludo': 'Ludo',
      'tablefootball': 'Baby-foot',
      'echecs': 'Échecs',
    };
    final gameTitle = gameTitles[widget.gameType] ?? widget.gameType;
    final isComingSoon = _comingSoonGames.contains(widget.gameType);
    final entryModeText = widget.entryMode == 'paid' ? '${widget.betAmount.toStringAsFixed(2)} Tokens' : 'Mode Gratuit';

    final p1 = _game?['player1'];
    final p1Id = p1 is Map ? p1['id']?.toString() : null;
    final p2 = _game?['player2'];
    final p2Id = p2 is Map ? p2['id']?.toString() : null;
    final isSpectator = (p1Id != '${widget.currentUserId}' && p2Id != '${widget.currentUserId}');

    return PopScope<void>(
      canPop: isComingSoon || _phase != 'playing' || isSpectator,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        _forfeitGame();
      },
      child: Scaffold(
        backgroundColor: bg,
        appBar: showAppBar
            ? AppBar(
                backgroundColor: bg,
                elevation: 0,
                leading: IconButton(
                  icon: Icon(Icons.arrow_back_ios_new_rounded, color: _textPrimaryColor),
                  onPressed: () {
                    if (isComingSoon || isSpectator) {
                      widget.onBackToLobby();
                    } else if (_phase == 'playing') {
                      _forfeitGame();
                    } else {
                      widget.onBackToLobby();
                    }
                  },
                ),
                centerTitle: true,
                title: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      gameTitle,
                      style: TextStyle(
                        color: _textPrimaryColor,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      entryModeText,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: _textSecondaryColor,
                      ),
                    ),
                  ],
                ),
                actions: [
                  if (_phase == 'playing') ...[
                    IconButton(
                      icon: Icon(Icons.card_giftcard_rounded, color: _primaryColor, size: 20),
                      onPressed: _showGiftModal,
                      tooltip: 'Envoyer un cadeau',
                    ),
                    IconButton(
                      icon: Icon(Icons.comment_outlined, color: widget.isDarkMode ? Colors.white70 : Colors.black87, size: 20),
                      onPressed: _showCommentsSheet,
                      tooltip: 'Commentaires',
                    ),
                  ],
                ],
              )
            : null,
        body: Stack(
          children: [
            SafeArea(
              child: _phase == 'creating'
                  ? _buildLoading()
                  : _phase == 'error'
                      ? _buildError()
                      : _buildGameUI(isDark),
            ),
            if (_giftAlerts.isNotEmpty)
              Align(
                alignment: Alignment.center,
                child: IgnorePointer(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: _giftAlerts.map((alert) => _buildGiftAlertWidget(alert)).toList(),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoading() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: Color(0xFF6F63FF)),
          SizedBox(height: 16),
          Text(
            'Création de la partie…',
            style: TextStyle(color: Colors.white60, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 56),
            const SizedBox(height: 16),
            Text(
              _errorMsg ?? 'Erreur inconnue',
              textAlign: TextAlign.center,
              style: TextStyle(color: _textPrimaryColor, fontSize: 15),
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton.icon(
                  onPressed: widget.onBackToLobby,
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Retour'),
                  style: TextButton.styleFrom(foregroundColor: _textSecondaryColor),
                ),
                const SizedBox(width: 16),
                ElevatedButton.icon(
                  onPressed: _createGame,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Réessayer'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _primaryColor,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGameUI(bool isDark) {
    return Column(
      children: [
        const SizedBox(height: 16), // Spacing between top bar and scoreboard

        // ── game-scoreboard ──────────────────────────────────────────────
        _buildGameScoreboard(isDark),

        const SizedBox(height: 8),

        // ── game-spectators-row ──────────────────────────────────────────
        _buildSpectatorsRow(),

        const SizedBox(height: 8),

        // ── game-turn-status-bar ─────────────────────────────────────────
        _buildGameTurnStatusBar(),

        const SizedBox(height: 12),

        // ── Board area ────────────────────────────────────────────────────
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Align(
              alignment: Alignment.topCenter,
              child: _buildBoardWidget(),
            ),
          ),
        ),

        // ── Action buttons when game over (fallback display) ──────────────
        if (_phase == 'over') _buildGameOverActions(),

        const SizedBox(height: 12),
      ],
    );
  }

  Widget _buildSpectatorsRow() {
    return GestureDetector(
      onTap: _showSpectatorsListModal,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: _cardBgColor,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _borderColor, width: 1),
        ),
        child: Row(
          children: [
            Icon(Icons.visibility_rounded, color: _primaryColor, size: 18),
            const SizedBox(width: 8),
            Text(
              'Spectateurs ($_spectatorCount)',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.bold,
                color: _textPrimaryColor,
                fontFamily: 'Outfit',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _spectatorsList.isEmpty
                  ? Text(
                      'Aucun spectateur en direct',
                      style: TextStyle(
                        fontSize: 12,
                        color: _textSecondaryColor,
                      ),
                    )
                  : SizedBox(
                      height: 24,
                      child: ListView.builder(
                        scrollDirection: Axis.horizontal,
                        itemCount: _spectatorsList.length > 5 ? 5 : _spectatorsList.length,
                        itemBuilder: (context, index) {
                          final spectator = _spectatorsList[index];
                          final name = spectator['first_name'] ?? spectator['username'] ?? 'S';
                          final avatar = _formatAvatarUrl(spectator['avatar']?.toString());
                          return Container(
                            margin: const EdgeInsets.only(right: 6),
                            child: CircleAvatar(
                              radius: 12,
                              backgroundImage: avatar != null && avatar.isNotEmpty
                                  ? NetworkImage(avatar)
                                  : null,
                              child: avatar == null || avatar.isEmpty
                                  ? Text(
                                      name.toString().substring(0, 1).toUpperCase(),
                                      style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold),
                                    )
                                  : null,
                            ),
                          );
                        },
                      ),
                    ),
            ),
            Icon(Icons.arrow_forward_ios_rounded, color: _textSecondaryColor, size: 12),
          ],
        ),
      ),
    );
  }

  Widget _buildGameScoreboard(bool isDark) {
    final me = _me;
    final opp = _opponent;

    final mySymbol = _mySymbol;
    final oppSymbol = mySymbol == 1 ? 2 : 1;

    final roundWinsSource = _game?['roundWins'];
    int myWins = roundWinsSource?['player${mySymbol == 1 ? 1 : 2}'] ?? 0;
    int oppWins = roundWinsSource?['player${mySymbol == 1 ? 2 : 1}'] ?? 0;

    // Fallback if game is finished but score is 0 - 0
    if (_phase == 'over' && myWins == 0 && oppWins == 0) {
      final winnerId = _gameOverData?['winnerId'] ?? _game?['winner'];
      final isDraw = winnerId == null || winnerId == 'draw';
      if (!isDraw && winnerId != null) {
        if (winnerId.toString() == '${widget.currentUserId}') {
          myWins = 1;
          oppWins = 0;
        } else {
          myWins = 0;
          oppWins = 1;
        }
      }
    }

    // Use current user's profile image from dashboard if available
    final String? myAvatar = _formatAvatarUrl(me?['avatar'] ?? widget.currentUserAvatar);
    final String? oppAvatar = _formatAvatarUrl(opp?['avatar']);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: _cardBgColor,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: _borderColor, width: 1),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Player 1 (Me)
          Expanded(
            child: _buildScoreboardPlayerCard(
              name: me?['name'] ?? 'Vous',
              avatar: myAvatar,
              symbol: mySymbol,
              isActive: _myTurn && _phase == 'playing',
              isDark: isDark,
              isP1: true,
            ),
          ),

          // VS & Score center section
          _buildCenterScoreSection(myWins, oppWins, isDark),

          // Player 2 (Opponent)
          Expanded(
            child: _buildScoreboardPlayerCard(
              name: opp?['name'] ?? 'Adversaire',
              avatar: oppAvatar,
              symbol: oppSymbol,
              isActive: !_myTurn && _phase == 'playing',
              isDark: isDark,
              isP1: false,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCenterScoreSection(int p1Wins, int p2Wins, bool isDark) {
    final scoreBg = isDark ? const Color(0xFF161616) : const Color(0xFFEEEEEE);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'VS',
            style: TextStyle(
              fontFamily: 'Outfit',
              fontWeight: FontWeight.w900,
              fontSize: 14,
              color: _textSecondaryColor.withOpacity(0.8),
            ),
          ),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: scoreBg,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: _borderColor, width: 1),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '$p1Wins',
                  style: TextStyle(
                    fontFamily: 'Outfit',
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: _primaryColor,
                  ),
                ),
                Text(
                  ' - ',
                  style: TextStyle(
                    fontFamily: 'Outfit',
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    color: _textSecondaryColor,
                  ),
                ),
                Text(
                  '$p2Wins',
                  style: const TextStyle(
                    fontFamily: 'Outfit',
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFFEC4899),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScoreboardPlayerCard({
    required String name,
    String? avatar,
    required int symbol,
    required bool isActive,
    required bool isDark,
    required bool isP1,
  }) {
    final playerColor = widget.gameType == 'ludo'
        ? (isP1 ? const Color(0xFFEF4444) : const Color(0xFF22C55E))
        : (isP1 ? _primaryColor : const Color(0xFFEC4899));

    final String symbolLabel = widget.gameType == 'ludo'
        ? (symbol == 1 ? 'Rouge (★)' : 'Vert (★)')
        : (widget.gameType == 'connect4'
            ? (symbol == 1 ? 'Rouge' : 'Jaune')
            : (symbol == 1 ? 'Noir (X)' : 'Blanc (O)'));
        
    final Color symbolBadgeBg = playerColor.withOpacity(0.12);
    final Color symbolBadgeText = playerColor;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Name (Top)
        Container(
          constraints: const BoxConstraints(maxWidth: 70),
          child: Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 11.0,
              fontWeight: FontWeight.w800,
              color: _textPrimaryColor,
            ),
          ),
        ),
        const SizedBox(height: 2),
        // Avatar Photo (Middle)
        Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            if (isActive)
              AnimatedBuilder(
                animation: _turnRingAnimation,
                builder: (context, child) {
                  return Transform.scale(
                    scale: _turnRingAnimation.value,
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFF10B981).withOpacity(0.4), width: 1.5),
                      ),
                    ),
                  );
                },
              ),
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: playerColor, width: 1.2),
              ),
              child: ClipOval(
                child: avatar != null && avatar.isNotEmpty
                    ? Image.network(
                        avatar,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) => _buildFallbackAvatar(name, playerColor),
                      )
                    : _buildFallbackAvatar(name, playerColor),
              ),
            ),
          ],
        ),
        const SizedBox(height: 3),
        // Pawn Color badge (Bottom)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.0),
          decoration: BoxDecoration(
            color: symbolBadgeBg,
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            symbolLabel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 7.5,
              fontWeight: FontWeight.bold,
              color: symbolBadgeText,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFallbackAvatar(String name, Color playerColor) {
    return Center(
      child: Text(
        name.substring(0, name.isNotEmpty ? 1 : 0).toUpperCase(),
        style: TextStyle(
          color: playerColor,
          fontWeight: FontWeight.bold,
          fontSize: 11.0,
        ),
      ),
    );
  }

  Widget _buildGameTurnStatusBar() {
    final label = _turnLabel;
    final isWin = _phase == 'over' && _gameOverData?['winnerId']?.toString() == '${widget.currentUserId}';
    final isDraw = _phase == 'over' && (_gameOverData?['winnerId'] == null || _gameOverData?['winnerId'] == 'draw');

    Color bg;
    Color text;
    Color border;

    if (_phase == 'over') {
      if (isWin) {
        bg = const Color(0x1F10B981);
        text = const Color(0xFF10B981);
        border = const Color(0x3310B981);
      } else if (isDraw) {
        bg = const Color(0x1F64748B);
        text = const Color(0xFF64748B);
        border = const Color(0x3364748B);
      } else {
        bg = const Color(0x1FEF4444);
        text = const Color(0xFFEF4444);
        border = const Color(0x33EF4444);
      }
    } else {
      bg = _primaryLightColor;
      text = _primaryColor;
      border = _primaryColor.withOpacity(0.15);
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: border, width: 1),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            style: TextStyle(
              color: text,
              fontWeight: FontWeight.w700,
              fontSize: 13.5,
              fontFamily: 'Outfit',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBoardWidget() {
    final board = _board;
    final isOver = _phase == 'over';

    if (widget.gameType == 'connect4') {
      return Connect4Board(
        board: board,
        currentPlayerSymbol: _currentPlayerSymbol,
        mySymbol: _mySymbol,
        myTurn: _myTurn && !isOver,
        gameOver: isOver,
        winningStones: _winningStones,
        lastMove: _lastMove,
        onColumnTap: _onConnect4ColTap,
        isDarkMode: widget.isDarkMode,
      );
    } else if (widget.gameType == 'gomoku') {
      return GomokuBoard(
        board: board,
        currentPlayerSymbol: _currentPlayerSymbol,
        mySymbol: _mySymbol,
        myTurn: _myTurn && !isOver,
        gameOver: isOver,
        winningStones: _winningStones,
        lastMove: _lastMove,
        onCellTap: _onGomokuCellTap,
        isDarkMode: widget.isDarkMode,
      );
    } else if (widget.gameType == 'ludo') {
      return _buildLudoBoardWidget(isOver);
    }

    // Baby-foot: draw the table
    if (widget.gameType == 'tablefootball') {
      return _buildTableFootballBoard(isOver);
    }

    // Coming soon for ludo & echecs
    final Map<String, Map<String, dynamic>> gameInfo = {
      'ludo': {
        'title': 'Ludo',
        'icon': Icons.casino_outlined,
        'color': const Color(0xFFEAB308),
      },
      'echecs': {
        'title': 'Échecs',
        'icon': Icons.emoji_events_outlined,
        'color': const Color(0xFF8B5CF6),
      },
    };

    final info = gameInfo[widget.gameType] ?? {'title': widget.gameType, 'icon': Icons.gamepad_outlined, 'color': const Color(0xFF673DE6)};

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    (info['color'] as Color),
                    (info['color'] as Color).withValues(alpha: 0.5),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                shape: BoxShape.circle,
              ),
              child: Icon(
                info['icon'] as IconData,
                color: Colors.white,
                size: 52,
              ),
            ),
            const SizedBox(height: 28),
            Text(
              info['title'] as String,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 26,
                fontWeight: FontWeight.bold,
                fontFamily: 'Outfit',
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Ce jeu arrive bientôt !',
              style: TextStyle(
                color: Color(0xFF673DE6),
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Nous travaillons activement sur cette fonctionnalité.\nRevenez bientôt pour y jouer.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.5),
                fontSize: 13,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 36),
            GestureDetector(
              onTap: widget.onBackToLobby,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 13),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFF833AB4),
                      Color(0xFFC13584),
                      Color(0xFFE1306C),
                      Color(0xFFFD1D1D),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'Retour au salon',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLudoBoardWidget(bool isOver) {
    final ludoState = (_game?['ludoState'] as Map?)?.cast<String, dynamic>() ?? {};
    final currentPlayerRaw = _game?['currentPlayer'];
    final currentSlot = currentPlayerRaw is int ? currentPlayerRaw : int.tryParse('$currentPlayerRaw') ?? 1;

    // Determine my slot: player1 is slot 1, player2 is slot 2
    final p1 = _game?['player1'];
    final p1Id = p1 is Map ? p1['id']?.toString() : null;
    final mySlot = p1Id == '${widget.currentUserId}' ? 1 : 2;

    final myTurn = _myTurn && !isOver;

    return LudoBoard(
      ludoState: ludoState,
      game: _game,
      mySlot: mySlot,
      currentSlot: currentSlot,
      myTurn: myTurn,
      gameOver: isOver,
      isDarkMode: widget.isDarkMode,
      gameId: _gameId ?? '',
      onRoll: () {
        if (_gameId != null) {
          GameSocketService.instance.emitLudoRoll(gameId: _gameId!);
        }
      },
      onTokenTap: (tokenIndex) {
        if (_gameId != null) {
          GameSocketService.instance.emitLudoTokenMove(gameId: _gameId!, tokenIndex: tokenIndex);
        }
      },
    );
  }

  Widget _buildTableFootballBoard(bool isOver) {
    if (_game == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final tfState = (_game?['tableFootballState'] as Map?)?.cast<String, dynamic>() ?? {};
    final currentPlayerRaw = _game?['currentPlayer'];
    final currentSlot = currentPlayerRaw is int ? currentPlayerRaw : int.tryParse('$currentPlayerRaw') ?? 1;

    // Determine my slot: player1 is slot 1, player2 is slot 2
    final p1 = _game?['player1'];
    final p1Id = p1 is Map ? p1['id']?.toString() : null;
    final mySlot = p1Id == '${widget.currentUserId}' ? 1 : 2;

    final myTurn = _myTurn && !isOver;

    // Real-time scores
    final scoresMap = tfState['scores'] ?? {};
    final p1Score = int.tryParse('${scoresMap['1']}') ?? 0;
    final p2Score = int.tryParse('${scoresMap['2']}') ?? 0;

    final p1Name = _game?['player1']?['username']?.toString() ?? 'Joueur 1';
    final p2Name = _game?['player2']?['username']?.toString() ?? 'Joueur 2';

    return Column(
      children: [
        // Scoreboard
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          color: widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildScorePanel(
                name: p1Name,
                score: p1Score,
                color: const Color(0xFFEF4444),
              ),
              Column(
                children: [
                  Text(
                    'VS',
                    style: TextStyle(
                      color: widget.isDarkMode ? Colors.white54 : Colors.black54,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      fontFamily: 'Outfit',
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: widget.isDarkMode ? Colors.white10 : Colors.black12,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Baby-foot',
                      style: TextStyle(
                        color: widget.isDarkMode ? Colors.white70 : Colors.black87,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'Outfit',
                      ),
                    ),
                  ),
                ],
              ),
              _buildScorePanel(
                name: p2Name,
                score: p2Score,
                color: const Color(0xFF3B82F6),
              ),
            ],
          ),
        ),
        // Pitch
        Expanded(
          child: Container(
            color: widget.isDarkMode ? const Color(0xFF0D0D1A) : const Color(0xFFF1F5F9),
            padding: const EdgeInsets.all(16),
            child: Center(
              child: TableFootballBoard(
                game: _game!,
                mySlot: mySlot,
                currentSlot: currentSlot,
                myTurn: myTurn,
                gameOver: isOver,
                isDarkMode: widget.isDarkMode,
                gameId: _gameId ?? '',
                onSync: (finalState) {
                  if (_gameId != null) {
                    GameSocketService.instance.emitMove(
                      gameId: _gameId!,
                      r: 0,
                      c: 0,
                      extra: {
                        'promotion': 'sync',
                        'finalState': finalState,
                        'nextPlayer': currentSlot == 1 ? 2 : 1,
                      },
                    );
                  }
                },
                onShot: (puckIndex, vx, vy) {
                  if (_gameId != null) {
                    GameSocketService.instance.emitMove(
                      gameId: _gameId!,
                      r: puckIndex,
                      c: 0,
                      extra: {
                        'promotion': 'shot',
                        'toR': (vx * 1000).toInt(),
                        'toC': (vy * 1000).toInt(),
                      },
                    );
                  }
                },
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildScorePanel({required String name, required int score, required Color color}) {
    return Column(
      children: [
        Text(
          score.toString(),
          style: TextStyle(
            color: color,
            fontSize: 36,
            fontWeight: FontWeight.w900,
            fontFamily: 'Outfit',
          ),
        ),
        Text(
          name,
          style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }

  Widget _buildGameOverActions() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: OutlinedButton.icon(
              onPressed: widget.onBackToLobby,
              icon: const Icon(Icons.home_outlined, size: 18),
              label: const Text('Lobby'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _textPrimaryColor,
                side: BorderSide(color: _borderColor),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 2,
            child: Container(
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFFE536DB),
                    Color(0xFF673DE6),
                    Color(0xFF3AB0FF),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: ElevatedButton.icon(
                onPressed: _createGame,
                icon: const Icon(Icons.refresh_rounded, size: 18, color: Colors.white),
                label: const Text('Rejouer', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Comment Button
          Container(
            decoration: BoxDecoration(
              color: widget.isDarkMode ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _borderColor),
            ),
            child: IconButton(
              onPressed: _showCommentsSheet,
              icon: Icon(Icons.comment_outlined, color: _primaryColor),
              tooltip: 'Commentaires',
            ),
          ),
          const SizedBox(width: 8),
          // Gift Button
          Container(
            decoration: BoxDecoration(
              color: widget.isDarkMode ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _borderColor),
            ),
            child: IconButton(
              onPressed: _showGiftModal,
              icon: Icon(Icons.card_giftcard_rounded, color: _primaryColor),
              tooltip: 'Cadeau',
            ),
          ),
        ],
      ),
    );
  }
}

/// CustomPainter that draws a top-down foosball (baby-foot) table
class _TableFootballPitchPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // --- Background pitch (green felt) ---
    final pitchPaint = Paint()..color = const Color(0xFF1A7A3C);
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, w, h), const Radius.circular(10)),
      pitchPaint,
    );

    // --- Pitch border (white lines) ---
    final linePaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;

    // Outer border
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(6, 6, w - 12, h - 12),
        const Radius.circular(8),
      ),
      linePaint,
    );

    // Center line
    canvas.drawLine(Offset(0, h / 2), Offset(w, h / 2), linePaint);

    // Center circle
    canvas.drawCircle(Offset(w / 2, h / 2), w * 0.15, linePaint);

    // Center dot
    final dotPaint = Paint()..color = Colors.white;
    canvas.drawCircle(Offset(w / 2, h / 2), 4, dotPaint);

    // --- Goals ---
    final goalWidth = w * 0.38;
    final goalDepth = h * 0.028;
    final goalX = (w - goalWidth) / 2;

    // Top goal (red team)
    final goalPaintRed = Paint()..color = const Color(0xFFEF4444).withOpacity(0.85);
    canvas.drawRect(Rect.fromLTWH(goalX, 0, goalWidth, goalDepth), goalPaintRed);
    canvas.drawRect(Rect.fromLTWH(goalX, 0, goalWidth, goalDepth),
        linePaint..color = Colors.white);

    // Bottom goal (blue team)
    final goalPaintBlue = Paint()..color = const Color(0xFF3B82F6).withOpacity(0.85);
    canvas.drawRect(Rect.fromLTWH(goalX, h - goalDepth, goalWidth, goalDepth), goalPaintBlue);
    canvas.drawRect(Rect.fromLTWH(goalX, h - goalDepth, goalWidth, goalDepth),
        linePaint..color = Colors.white);

    // Reset line paint
    linePaint.color = Colors.white;
    linePaint.strokeWidth = 2.5;

    // --- Goal areas ---
    final areaWidth = w * 0.6;
    final areaHeight = h * 0.1;
    final areaX = (w - areaWidth) / 2;

    // Top goal area
    canvas.drawRect(Rect.fromLTWH(areaX, 0, areaWidth, areaHeight), linePaint);
    // Bottom goal area
    canvas.drawRect(Rect.fromLTWH(areaX, h - areaHeight, areaWidth, areaHeight), linePaint);

    // --- Rods & Players ---
    final rodPaint = Paint()
      ..color = Colors.brown.shade700
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;

    // Rod Y positions (from top): keeper, 2-bar, 5-bar, 3-bar, keeper
    final rodYs = [h * 0.1, h * 0.26, h * 0.42, h * 0.58, h * 0.74, h * 0.90];

    for (final y in rodYs) {
      canvas.drawLine(Offset(0, y), Offset(w, y), rodPaint);
    }

    // --- Player figures on rods ---
    void drawPlayers(double rodY, int count, Color color) {
      final playerPaint = Paint()..color = color;
      final playerBorderPaint = Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5;
      final spacing = w / (count + 1);
      for (int i = 1; i <= count; i++) {
        final cx = spacing * i;
        // Body (ellipse)
        canvas.drawOval(
          Rect.fromCenter(center: Offset(cx, rodY), width: 10, height: 14),
          playerPaint,
        );
        canvas.drawOval(
          Rect.fromCenter(center: Offset(cx, rodY), width: 10, height: 14),
          playerBorderPaint,
        );
        // Head
        canvas.drawCircle(Offset(cx, rodY - 10), 5, playerPaint);
        canvas.drawCircle(Offset(cx, rodY - 10), 5, playerBorderPaint);
      }
    }

    // Red team rods (top half)
    drawPlayers(rodYs[0], 1, const Color(0xFFEF4444));  // keeper
    drawPlayers(rodYs[1], 2, const Color(0xFFEF4444));  // 2-bar
    drawPlayers(rodYs[2], 5, const Color(0xFFEF4444));  // 5-bar

    // Blue team rods (bottom half)
    drawPlayers(rodYs[3], 3, const Color(0xFF3B82F6));  // 3-bar
    drawPlayers(rodYs[4], 2, const Color(0xFF3B82F6));  // 2-bar
    drawPlayers(rodYs[5], 1, const Color(0xFF3B82F6));  // keeper

    // --- Ball (center) ---
    final ballPaint = Paint()..color = Colors.white;
    final ballShadow = Paint()
      ..color = Colors.black45
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3);
    canvas.drawCircle(Offset(w / 2, h / 2), 7, ballShadow);
    canvas.drawCircle(Offset(w / 2, h / 2), 7, ballPaint);

    // Ball detail
    final ballDetailPaint = Paint()
      ..color = Colors.black26
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.drawCircle(Offset(w / 2, h / 2), 7, ballDetailPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
