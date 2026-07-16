import 'package:flutter/material.dart';
import 'dart:math' as math;

/// Native Flutter Puissance 4 (Connect 4) board matching the web design exactly.
/// Board is 6 rows × 7 columns.
/// Player 1 = symbol 1 (red disc), Player 2 = symbol 2 (yellow disc).
class Connect4Board extends StatefulWidget {
  final List<List<int>> board; // 6×7 grid, 0=empty 1=p1 2=p2
  final int currentPlayerSymbol; // 1 or 2
  final int mySymbol; // which player am I
  final bool myTurn;
  final bool gameOver;
  final List<Map<String, dynamic>>? winningStones;
  final Function(int column) onColumnTap;
  final Map<String, dynamic>? lastMove;
  final bool isDarkMode;

  const Connect4Board({
    super.key,
    required this.board,
    required this.currentPlayerSymbol,
    required this.mySymbol,
    required this.myTurn,
    required this.gameOver,
    required this.onColumnTap,
    required this.isDarkMode,
    this.winningStones,
    this.lastMove,
  });

  @override
  State<Connect4Board> createState() => _Connect4BoardState();
}

class _Connect4BoardState extends State<Connect4Board>
    with TickerProviderStateMixin {
  int? _hoveredCol;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  // Web Design Colors
  static const Color _p1DiscLight = Color(0xFFFF4D4D);
  static const Color _p1DiscDark = Color(0xFFC81010);
  static const Color _p1DiscBorder = Color(0xFF990000);

  static const Color _p2DiscLight = Color(0xFFFFD000);
  static const Color _p2DiscDark = Color(0xFFD48B00);
  static const Color _p2DiscBorder = Color(0xFF996000);

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 900),
      vsync: this,
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  bool _isWinning(int row, int col) {
    if (widget.winningStones == null) return false;
    return widget.winningStones!
        .any((s) => s['r'] == row && s['c'] == col);
  }

  bool _isLastMove(int row, int col) {
    final lm = widget.lastMove;
    if (lm == null) return false;
    return lm['r'] == row && lm['c'] == col;
  }

  @override
  Widget build(BuildContext context) {
    // Web: .connectfour-grid-container and .connectfour-grid
    final cardBgColor = widget.isDarkMode ? const Color(0xFF151F32) : const Color(0xFFFFFFFF);
    final borderColor = widget.isDarkMode ? const Color(0xFF1E293B) : const Color(0xFFEBEDF0);
    
    // Web board background:
    // Light: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)
    // Dark: linear-gradient(135deg, #1e3a8a 0%, #1e293b 100%)
    final boardGradient = widget.isDarkMode
        ? const LinearGradient(
            colors: [Color(0xFF1E3A8A), Color(0xFF1E293B)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          )
        : const LinearGradient(
            colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          );

    return LayoutBuilder(builder: (context, constraints) {
      // Math fix: account for 0.85 * cellSize required for the drop button header to avoid overflow
      final cellSize = math.min(
        (constraints.maxWidth - 32) / 7,
        (constraints.maxHeight - 32) / 6.8,
      );

      final hoverBg = widget.isDarkMode ? Colors.white.withOpacity(0.06) : Colors.black.withOpacity(0.04);
      final activeColor = widget.mySymbol == 1 ? const Color(0xFFFF4D4D) : const Color(0xFFFFD000);

      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Column drop buttons matching .c4-drop-header and .c4-drop-btn
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(7, (col) {
              final isHovered = _hoveredCol == col;
              final canDrop = widget.myTurn && !widget.gameOver && widget.board[0][col] == 0;

              return Container(
                width: cellSize,
                height: cellSize * 0.85,
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                child: GestureDetector(
                  onTap: canDrop ? () => widget.onColumnTap(col) : null,
                  onTapDown: (_) {
                    if (canDrop) {
                      setState(() => _hoveredCol = col);
                    }
                  },
                  onTapUp: (_) => setState(() => _hoveredCol = null),
                  onTapCancel: () => setState(() => _hoveredCol = null),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isHovered ? activeColor : hoverBg,
                      border: Border.all(
                        color: isHovered ? activeColor : borderColor,
                        width: 1,
                      ),
                      boxShadow: isHovered
                          ? [
                              BoxShadow(
                                color: activeColor.withOpacity(0.35),
                                blurRadius: 8,
                                offset: const Offset(0, 3),
                              )
                            ]
                          : [],
                    ),
                    child: Center(
                      child: Icon(
                        Icons.arrow_downward_rounded,
                        color: isHovered
                            ? Colors.white
                            : (widget.isDarkMode ? Colors.white70 : Colors.black54),
                        size: cellSize * 0.4,
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
          const SizedBox(height: 6),

          // Main board container (replicates web's .connectfour-grid-container and .connectfour-grid)
          Container(
            decoration: BoxDecoration(
              color: cardBgColor,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: borderColor, width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.08),
                  blurRadius: 16,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            padding: const EdgeInsets.all(12),
            child: Container(
              decoration: BoxDecoration(
                gradient: boardGradient,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withOpacity(0.1), width: 1),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.25),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(10),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: List.generate(6, (row) {
                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: List.generate(7, (col) {
                      final isWin = _isWinning(row, col);
                      final isLast = _isLastMove(row, col);
                      final cellVal = widget.board[row][col];

                      return GestureDetector(
                        onTap: widget.myTurn && !widget.gameOver && cellVal == 0
                            ? () => widget.onColumnTap(col)
                            : null,
                        onTapDown: (_) {
                          if (widget.myTurn && !widget.gameOver) {
                            setState(() => _hoveredCol = col);
                          }
                        },
                        onTapUp: (_) => setState(() => _hoveredCol = null),
                        onTapCancel: () => setState(() => _hoveredCol = null),
                        child: Container(
                          width: cellSize,
                          height: cellSize,
                          padding: const EdgeInsets.all(4),
                          child: isWin
                              ? AnimatedBuilder(
                                  animation: _pulseAnimation,
                                  builder: (_, __) => _buildCell(
                                    cellVal,
                                    cardBgColor,
                                    isWin: true,
                                    isLast: isLast,
                                    scale: _pulseAnimation.value,
                                  ),
                                )
                              : _buildCell(cellVal, cardBgColor,
                                  isWin: false, isLast: isLast),
                        ),
                      );
                    }),
                  );
                }),
              ),
            ),
          ),
        ],
      );
    });
  }

  Widget _buildCell(int val, Color cardBgColor, {bool isWin = false, bool isLast = false, double scale = 1.0}) {
    // 0 = empty, 1 = player1, 2 = player2
    return Transform.scale(
      scale: scale,
      child: Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          // If empty, cell background matches card background, with an inner shadow shadow-like overlay
          color: val == 0 ? cardBgColor : null,
          gradient: val == 1
              ? const RadialGradient(
                  center: Alignment(-0.3, -0.3),
                  colors: [_p1DiscLight, _p1DiscDark],
                  stops: [0.0, 0.8],
                )
              : val == 2
                  ? const RadialGradient(
                      center: Alignment(-0.3, -0.3),
                      colors: [_p2DiscLight, _p2DiscDark],
                      stops: [0.0, 0.8],
                    )
                  : null,
          border: val == 1
              ? Border.all(color: _p1DiscBorder, width: 1)
              : val == 2
                  ? Border.all(color: _p2DiscBorder, width: 1)
                  : null,
          boxShadow: [
            // Deep inner shadow for empty holes (replicates box-shadow: inset 0 3px 6px rgba(0,0,0,0.85))
            if (val == 0)
              BoxShadow(
                color: Colors.black.withOpacity(0.75),
                blurRadius: 4,
                spreadRadius: -1,
                offset: const Offset(0, 3),
              ),
            // Outer shadow and highlight for discs
            if (val > 0) ...[
              BoxShadow(
                color: Colors.black.withOpacity(0.3),
                blurRadius: 4,
                offset: const Offset(0, 3),
              ),
              if (isLast)
                const BoxShadow(
                  color: Colors.white70,
                  blurRadius: 8,
                  spreadRadius: 2,
                ),
              if (isWin)
                BoxShadow(
                  color: (val == 1 ? Colors.redAccent : Colors.yellowAccent).withOpacity(0.6),
                  blurRadius: 14,
                  spreadRadius: 3,
                ),
            ]
          ],
        ),
        child: val > 0
            ? Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  // Glassmorphic shine on discs (radial gradient overlay)
                  gradient: RadialGradient(
                    center: const Alignment(-0.35, -0.35),
                    colors: [
                      Colors.white.withOpacity(0.35),
                      Colors.transparent,
                    ],
                    stops: const [0.0, 0.55],
                  ),
                  // Last played highlight: inner white ring
                  border: isLast
                      ? Border.all(color: Colors.white, width: 2.5)
                      : null,
                ),
              )
            : null,
      ),
    );
  }
}
