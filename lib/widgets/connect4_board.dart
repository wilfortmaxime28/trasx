import 'package:flutter/material.dart';
import 'dart:math' as math;

/// Native Flutter Puissance 4 (Connect 4) board.
/// Board is 6 rows × 7 columns.
/// Player 1 = symbol 1 (red), Player 2 = symbol 2 (yellow).
class Connect4Board extends StatefulWidget {
  final List<List<int>> board; // 6×7 grid, 0=empty 1=p1 2=p2
  final int currentPlayerSymbol; // 1 or 2
  final int mySymbol; // which player am I
  final bool myTurn;
  final bool gameOver;
  final List<Map<String, dynamic>>? winningStones;
  final Function(int column) onColumnTap;
  final Map<String, dynamic>? lastMove;

  const Connect4Board({
    super.key,
    required this.board,
    required this.currentPlayerSymbol,
    required this.mySymbol,
    required this.myTurn,
    required this.gameOver,
    required this.onColumnTap,
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

  static const Color _p1Color = Color(0xFFEF4444); // red
  static const Color _p2Color = Color(0xFFFACC15); // yellow
  static const Color _boardColor = Color(0xFF1E3A8A); // deep blue
  static const Color _boardEdgeColor = Color(0xFF1E40AF);
  static const Color _emptyColor = Color(0xFF0F172A);

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 900),
      vsync: this,
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 0.7, end: 1.0).animate(
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
    return LayoutBuilder(builder: (context, constraints) {
      final cellSize = math.min(
        (constraints.maxWidth - 16) / 7,
        (constraints.maxHeight - 16) / 7,
      );

      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Column drop indicators
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(7, (col) {
              final active = widget.myTurn &&
                  !widget.gameOver &&
                  _hoveredCol == col;
              return SizedBox(
                width: cellSize,
                height: cellSize * 0.5,
                child: Center(
                  child: AnimatedOpacity(
                    opacity: active ? 1.0 : 0.0,
                    duration: const Duration(milliseconds: 150),
                    child: Icon(
                      Icons.arrow_drop_down_rounded,
                      color: widget.mySymbol == 1 ? _p1Color : _p2Color,
                      size: cellSize * 0.7,
                    ),
                  ),
                ),
              );
            }),
          ),

          // Board
          Container(
            decoration: BoxDecoration(
              color: _boardColor,
              borderRadius: BorderRadius.circular(12),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x441E3A8A),
                  blurRadius: 24,
                  offset: Offset(0, 8),
                ),
              ],
              border: Border.all(color: _boardEdgeColor, width: 3),
            ),
            padding: const EdgeInsets.all(6),
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
                        padding: const EdgeInsets.all(3),
                        child: isWin
                            ? AnimatedBuilder(
                                animation: _pulseAnimation,
                                builder: (_, __) => _buildCell(
                                  cellVal,
                                  isWin: true,
                                  isLast: isLast,
                                  scale: _pulseAnimation.value,
                                ),
                              )
                            : _buildCell(cellVal,
                                isWin: false, isLast: isLast),
                      ),
                    );
                  }),
                );
              }),
            ),
          ),
        ],
      );
    });
  }

  Widget _buildCell(int val, {bool isWin = false, bool isLast = false, double scale = 1.0}) {
    final color = val == 1
        ? _p1Color
        : val == 2
            ? _p2Color
            : _emptyColor;

    final shadow = isWin
        ? [BoxShadow(color: color.withOpacity(0.8), blurRadius: 12, spreadRadius: 2)]
        : isLast
            ? [BoxShadow(color: color.withOpacity(0.5), blurRadius: 6)]
            : val != 0
                ? [BoxShadow(color: color.withOpacity(0.3), blurRadius: 4, offset: const Offset(0, 2))]
                : [];

    return Transform.scale(
      scale: scale,
      child: Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color,
          boxShadow: List<BoxShadow>.from(shadow),
          border: isLast && val != 0
              ? Border.all(color: Colors.white.withOpacity(0.5), width: 2)
              : null,
        ),
        child: val == 0
            ? Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    center: const Alignment(-0.3, -0.3),
                    colors: [
                      Colors.white.withOpacity(0.05),
                      Colors.transparent,
                    ],
                  ),
                ),
              )
            : Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    center: const Alignment(-0.35, -0.35),
                    colors: [
                      Colors.white.withOpacity(0.35),
                      Colors.transparent,
                    ],
                    stops: const [0.0, 0.55],
                  ),
                ),
              ),
      ),
    );
  }
}
