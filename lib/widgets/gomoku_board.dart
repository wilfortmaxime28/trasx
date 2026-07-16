import 'package:flutter/material.dart';
import 'dart:math' as math;

/// Native Flutter Gomoku board matching the web's premium dark glassmorphic design exactly.
/// Board is 15×15 grid.
/// Player 1 = symbol 1 (black stone), Player 2 = symbol 2 (white stone).
class GomokuBoard extends StatefulWidget {
  final List<List<int>> board; // 15×15 grid, 0=empty 1=p1 2=p2
  final int currentPlayerSymbol;
  final int mySymbol;
  final bool myTurn;
  final bool gameOver;
  final List<Map<String, dynamic>>? winningStones;
  final Function(int row, int col) onCellTap;
  final Map<String, dynamic>? lastMove;
  final bool isDarkMode;

  const GomokuBoard({
    super.key,
    required this.board,
    required this.currentPlayerSymbol,
    required this.mySymbol,
    required this.myTurn,
    required this.gameOver,
    required this.onCellTap,
    required this.isDarkMode,
    this.winningStones,
    this.lastMove,
  });

  @override
  State<GomokuBoard> createState() => _GomokuBoardState();
}

class _GomokuBoardState extends State<GomokuBoard>
    with SingleTickerProviderStateMixin {
  int? _hoverRow;
  int? _hoverCol;
  late AnimationController _pulseCtrl;
  late Animation<double> _pulse;

  // Web Design Colors
  // Grid background uses --border-color: #ebedf0 (light) or #1e293b (dark)
  // Cells use background: rgba(15, 23, 42, 0.65)
  static const Color _cellBgColor = Color(0xA60F172A); // rgba(15, 23, 42, 0.65)
  static const Color _cellBgHover = Color(0xD90F172A); // rgba(15, 23, 42, 0.85)
  
  static const Color _stoneBlackLight = Color(0xFF4B5563);
  static const Color _stoneBlackDark = Color(0xFF0F172A);
  static const Color _stoneBlackBorder = Color(0xFF020617);

  static const Color _stoneWhiteLight = Color(0xFFFFFFFF);
  static const Color _stoneWhiteDark = Color(0xFFE2E8F0);
  static const Color _stoneWhiteBorder = Color(0xFFCBD5E1);

  static const Color _lastPlayedGold = Color(0xFFEAB308); // #eab308

  static const int _size = 15;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    )..repeat(reverse: true);
    _pulse = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  bool _isWinning(int row, int col) {
    return widget.winningStones?.any((s) => s['r'] == row && s['c'] == col) ?? false;
  }

  bool _isLastMove(int row, int col) {
    final lm = widget.lastMove;
    if (lm == null) return false;
    return lm['r'] == row && lm['c'] == col;
  }

  @override
  Widget build(BuildContext context) {
    // Web: .gomoku-board container has border-radius 16px, background var(--border-color)
    // Platform borders: Dark uses Colors.white.withOpacity(0.1), Light uses Colors.black.withOpacity(0.1)
    final gridBorderColor = widget.isDarkMode ? Colors.white.withOpacity(0.1) : Colors.black.withOpacity(0.1);

    return LayoutBuilder(builder: (context, constraints) {
      // Subtract margins/paddings from boardSize to be absolutely overflow-free
      final boardSize = math.min(constraints.maxWidth, constraints.maxHeight) - 8;
      
      return Container(
        width: boardSize,
        height: boardSize,
        decoration: BoxDecoration(
          color: gridBorderColor,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.2),
              blurRadius: 16,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        padding: const EdgeInsets.all(2), // replicates web's padding: 2px
        child: GridView.builder(
          padding: EdgeInsets.zero, // Crucial fix: prevents native scrollview vertical padding overflows
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: _size,
            crossAxisSpacing: 1, // 1px gaps creating clean grid lines
            mainAxisSpacing: 1,
          ),
          itemCount: _size * _size,
          itemBuilder: (context, index) {
            final row = index ~/ _size;
            final col = index % _size;
            final val = widget.board[row][col];
            final isWin = _isWinning(row, col);
            final isLast = _isLastMove(row, col);
            final isHover = _hoverRow == row && _hoverCol == col && val == 0;

            return GestureDetector(
              onTap: widget.myTurn && !widget.gameOver && val == 0
                  ? () {
                      setState(() {
                        _hoverRow = null;
                        _hoverCol = null;
                      });
                      widget.onCellTap(row, col);
                    }
                  : null,
              onTapDown: (_) {
                if (widget.myTurn && !widget.gameOver && val == 0) {
                  setState(() {
                    _hoverRow = row;
                    _hoverCol = col;
                  });
                }
              },
              onTapUp: (_) => setState(() {
                _hoverRow = null;
                _hoverCol = null;
              }),
              onTapCancel: () => setState(() {
                _hoverRow = null;
                _hoverCol = null;
              }),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                decoration: BoxDecoration(
                  color: isHover ? _cellBgHover : _cellBgColor,
                ),
                alignment: Alignment.center,
                child: Padding(
                  padding: const EdgeInsets.all(2),
                  child: val == 0
                      ? isHover
                          ? _buildGhostStone(widget.mySymbol)
                          : const SizedBox.shrink()
                      : isWin
                          ? AnimatedBuilder(
                              animation: _pulse,
                              builder: (_, __) => Transform.scale(
                                scale: _pulse.value,
                                child: _buildStone(val, isLast: isLast, isWin: true),
                              ),
                            )
                          : _buildStone(val, isLast: isLast),
                ),
              ),
            );
          },
        ),
      );
    });
  }

  Widget _buildStone(int val, {bool isLast = false, bool isWin = false}) {
    // Web black: radial-gradient(circle at 30% 30%, #4b5563, #0f172a 75%)
    // Web white: radial-gradient(circle at 30% 30%, #ffffff, #e2e8f0 80%)
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: val == 1
            ? const RadialGradient(
                center: Alignment(-0.4, -0.4),
                colors: [_stoneBlackLight, _stoneBlackDark],
                stops: [0.0, 0.75],
              )
            : const RadialGradient(
                center: Alignment(-0.4, -0.4),
                colors: [_stoneWhiteLight, _stoneWhiteDark],
                stops: [0.0, 0.8],
              ),
        border: val == 1
            ? Border.all(color: _stoneBlackBorder, width: 1)
            : Border.all(color: _stoneWhiteBorder, width: 1),
        boxShadow: [
          // Web stone placement animation and shadows
          BoxShadow(
            color: Colors.black.withOpacity(isWin ? 0.75 : 0.45),
            blurRadius: isWin ? 10 : 5,
            offset: const Offset(1, 2),
          ),
          if (isLast)
            const BoxShadow(
              color: _lastPlayedGold,
              blurRadius: 4,
              spreadRadius: 1.5,
            ),
          if (isWin)
            const BoxShadow(
              color: Color(0xFF10B981), // #10b981
              blurRadius: 10,
              spreadRadius: 2.5,
            ),
        ],
      ),
      child: isLast
          ? Center(
              child: Container(
                width: 5,
                height: 5,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: _lastPlayedGold,
                  boxShadow: [
                    BoxShadow(color: _lastPlayedGold, blurRadius: 4, spreadRadius: 1),
                  ],
                ),
              ),
            )
          : null,
    );
  }

  Widget _buildGhostStone(int symbol) {
    // Dashed preview of stone
    final color = symbol == 1 ? _stoneBlackDark : _stoneWhiteLight;
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withOpacity(0.25),
        border: Border.all(
          color: const Color(0xFF3B82F6).withOpacity(0.5), // dashed var(--primary) preview
          width: 1,
          style: BorderStyle.solid,
        ),
      ),
    );
  }
}
