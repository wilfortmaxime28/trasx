import 'package:flutter/material.dart';
import 'dart:math' as math;

/// Native Flutter Gomoku (5-in-a-row) board.
/// Board is 15×15.
/// Player 1 = symbol 1 (black stones), Player 2 = symbol 2 (white stones).
class GomokuBoard extends StatefulWidget {
  final List<List<int>> board; // 15×15 grid, 0=empty 1=p1 2=p2
  final int currentPlayerSymbol;
  final int mySymbol;
  final bool myTurn;
  final bool gameOver;
  final List<Map<String, dynamic>>? winningStones;
  final Function(int row, int col) onCellTap;
  final Map<String, dynamic>? lastMove;

  const GomokuBoard({
    super.key,
    required this.board,
    required this.currentPlayerSymbol,
    required this.mySymbol,
    required this.myTurn,
    required this.gameOver,
    required this.onCellTap,
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

  static const Color _boardBg = Color(0xFFDEB887);     // burlywood classic board
  static const Color _lineColor = Color(0xFF8B6914);
  static const Color _p1Color = Color(0xFF1A1A1A);     // black
  static const Color _p2Color = Color(0xFFF5F5DC);     // cream white
  static const Color _p2Border = Color(0xFFAAAAAA);
  static const int _size = 15;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    )..repeat(reverse: true);
    _pulse = Tween<double>(begin: 0.75, end: 1.0).animate(
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
    return LayoutBuilder(builder: (context, constraints) {
      final boardSize = math.min(constraints.maxWidth, constraints.maxHeight);
      final cellSize = (boardSize - 16) / _size;
      final stoneRadius = cellSize * 0.42;

      return Container(
        width: boardSize,
        height: boardSize,
        decoration: BoxDecoration(
          color: _boardBg,
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [
            BoxShadow(color: Color(0x66000000), blurRadius: 16, offset: Offset(0, 6)),
          ],
        ),
        child: Stack(
          children: [
            // Grid lines (custom painter)
            Padding(
              padding: EdgeInsets.all(cellSize / 2),
              child: CustomPaint(
                size: Size(boardSize - cellSize, boardSize - cellSize),
                painter: _GomokuGridPainter(
                  size: _size,
                  lineColor: _lineColor,
                ),
              ),
            ),

            // Star points (hoshi)
            ..._hoshiPoints(cellSize),

            // Stones & tap targets
            ...List.generate(_size, (row) {
              return List.generate(_size, (col) {
                final val = widget.board[row][col];
                final isWin = _isWinning(row, col);
                final isLast = _isLastMove(row, col);
                final isHover = _hoverRow == row && _hoverCol == col && val == 0;
                final cx = cellSize / 2 + col * cellSize;
                final cy = cellSize / 2 + row * cellSize;

                return Positioned(
                  left: cx - stoneRadius,
                  top: cy - stoneRadius,
                  width: stoneRadius * 2,
                  height: stoneRadius * 2,
                  child: GestureDetector(
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
                );
              });
            }).expand((e) => e),
          ],
        ),
      );
    });
  }

  Widget _buildStone(int val, {bool isLast = false, bool isWin = false}) {
    final color = val == 1 ? _p1Color : _p2Color;
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        border: val == 2
            ? Border.all(color: _p2Border, width: 1.5)
            : null,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(isWin ? 0.7 : 0.4),
            blurRadius: isWin ? 10 : 5,
            offset: const Offset(1, 2),
          ),
          if (isWin)
            BoxShadow(
              color: (val == 1 ? Colors.red : Colors.yellow).withOpacity(0.5),
              blurRadius: 12,
              spreadRadius: 3,
            ),
        ],
        gradient: RadialGradient(
          center: const Alignment(-0.4, -0.4),
          colors: val == 1
              ? [const Color(0xFF555555), const Color(0xFF0A0A0A)]
              : [const Color(0xFFFFFFF0), const Color(0xFFCCCCCC)],
          stops: const [0.0, 1.0],
        ),
      ),
      child: isLast
          ? Center(
              child: Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: val == 1
                      ? Colors.white.withOpacity(0.5)
                      : Colors.black.withOpacity(0.4),
                ),
              ),
            )
          : null,
    );
  }

  Widget _buildGhostStone(int symbol) {
    final color = symbol == 1 ? _p1Color : _p2Color;
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withOpacity(0.35),
        border: symbol == 2
            ? Border.all(color: _p2Border.withOpacity(0.4))
            : null,
      ),
    );
  }

  List<Widget> _hoshiPoints(double cellSize) {
    // Standard 15x15 gomoku star points
    const points = [
      [3, 3], [3, 7], [3, 11],
      [7, 3], [7, 7], [7, 11],
      [11, 3], [11, 7], [11, 11],
    ];
    return points.map((p) {
      final cx = cellSize / 2 + p[1] * cellSize;
      final cy = cellSize / 2 + p[0] * cellSize;
      return Positioned(
        left: cx - 3,
        top: cy - 3,
        child: Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _lineColor,
          ),
        ),
      );
    }).toList();
  }
}

class _GomokuGridPainter extends CustomPainter {
  final int size;
  final Color lineColor;

  _GomokuGridPainter({required this.size, required this.lineColor});

  @override
  void paint(Canvas canvas, Size canvasSize) {
    final paint = Paint()
      ..color = lineColor
      ..strokeWidth = 0.8;

    final cellW = canvasSize.width / (size - 1);
    final cellH = canvasSize.height / (size - 1);

    for (int i = 0; i < size; i++) {
      // vertical
      canvas.drawLine(
        Offset(i * cellW, 0),
        Offset(i * cellW, canvasSize.height),
        paint,
      );
      // horizontal
      canvas.drawLine(
        Offset(0, i * cellH),
        Offset(canvasSize.width, i * cellH),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
