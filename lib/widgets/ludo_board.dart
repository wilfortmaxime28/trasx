import 'dart:math' as math;
import 'package:flutter/material.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirror of backend constants)
// ─────────────────────────────────────────────────────────────────────────────
const _kLoopLength = 52;
const _kFinalStep = 56;
const _kSafeGlobalIndices = {0, 8, 13, 21, 26, 34, 39, 47};
const _kStartIndices = {1: 0, 2: 13, 3: 26, 4: 39};

final _kColors = <int, Color>{
  1: const Color(0xFFEF4444), // red
  2: const Color(0xFF22C55E), // green
  3: const Color(0xFFF59E0B), // yellow
  4: const Color(0xFF3B82F6), // blue
};

const _kColorNames = {1: 'Rouges', 2: 'Verts', 3: 'Jaunes', 4: 'Bleus'};

// ─────────────────────────────────────────────────────────────────────────────
// LudoBoard
// ─────────────────────────────────────────────────────────────────────────────
class LudoBoard extends StatefulWidget {
  final Map<String, dynamic> ludoState;
  final Map<String, dynamic>? game;
  final int mySlot;
  final int currentSlot;
  final bool myTurn;
  final bool gameOver;
  final bool isDarkMode;
  final String gameId;
  final VoidCallback onRoll;
  final void Function(int tokenIndex) onTokenTap;

  const LudoBoard({
    super.key,
    required this.ludoState,
    required this.game,
    required this.mySlot,
    required this.currentSlot,
    required this.myTurn,
    required this.gameOver,
    required this.isDarkMode,
    required this.gameId,
    required this.onRoll,
    required this.onTokenTap,
  });

  @override
  State<LudoBoard> createState() => _LudoBoardState();
}

class _LudoBoardState extends State<LudoBoard> with TickerProviderStateMixin {
  late AnimationController _pulseAnim;
  int _displayedDie = 1;
  bool _rolling = false;

  final Map<int, List<double>> _visualSteps = {};

  @override
  void initState() {
    super.initState();
    _pulseAnim = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat(reverse: true);
    
    // Initialize visual steps matching current state
    for (int s = 1; s <= 4; s++) {
      _visualSteps[s] = _getTokens(s).map((step) => step.toDouble()).toList();
    }
  }

  @override
  void didUpdateWidget(LudoBoard old) {
    super.didUpdateWidget(old);
    final newDie = widget.ludoState['currentDie'];
    final oldDie = old.ludoState['currentDie'];
    if (newDie != null && newDie != oldDie) {
      _animateDice(newDie is int ? newDie : int.tryParse('$newDie') ?? 1);
    }

    // Trigger step-by-step animations for any visual mismatch
    for (int s = 1; s <= 4; s++) {
      final oldTokens = _getTokensFromState(old.ludoState, s);
      final newTokens = _getTokensFromState(widget.ludoState, s);
      for (int i = 0; i < 4; i++) {
        final oldStep = oldTokens[i];
        final newStep = newTokens[i];
        if (newStep != oldStep) {
          _animateTokenStepByStep(s, i, oldStep, newStep);
        }
      }
    }
  }

  List<int> _getTokensFromState(Map<String, dynamic> state, int slot) {
    final players = state['players'];
    if (players == null) return [-1, -1, -1, -1];
    final p = players['$slot'] ?? players[slot];
    if (p == null) return [-1, -1, -1, -1];
    final raw = p['tokens'];
    if (raw is! List) return [-1, -1, -1, -1];
    return raw.map<int>((e) => (e ?? -1) is int ? (e ?? -1) : int.tryParse('${e ?? -1}') ?? -1).toList();
  }

  void _animateTokenStepByStep(int slot, int tokenIdx, int fromStep, int toStep) async {
    // Instant jump for reset, backward move, or exit initialization
    if (toStep < fromStep || fromStep == -1) {
      if (mounted) {
        setState(() {
          _visualSteps[slot]?[tokenIdx] = toStep.toDouble();
        });
      }
      return;
    }

    // Incremental step-by-step animation loop
    double current = fromStep.toDouble();
    while (current < toStep) {
      current += 0.08;
      if (current > toStep) current = toStep.toDouble();
      if (!mounted) return;
      setState(() {
        _visualSteps[slot]?[tokenIdx] = current;
      });
      await Future.delayed(const Duration(milliseconds: 14));
    }
  }

  Future<void> _animateDice(int value) async {
    setState(() => _rolling = true);
    for (int i = 0; i < 8; i++) {
      await Future.delayed(const Duration(milliseconds: 60));
      if (mounted) setState(() => _displayedDie = (i % 6) + 1);
    }
    if (mounted) setState(() { _displayedDie = value; _rolling = false; });
  }

  @override
  void dispose() {
    _pulseAnim.dispose();
    super.dispose();
  }

  List<int> _getTokens(int slot) {
    final players = widget.ludoState['players'];
    if (players == null) return [-1, -1, -1, -1];
    final p = players['$slot'] ?? players[slot];
    if (p == null) return [-1, -1, -1, -1];
    final raw = p['tokens'];
    if (raw is! List) return [-1, -1, -1, -1];
    return raw.map<int>((e) => (e ?? -1) is int ? (e ?? -1) : int.tryParse('${e ?? -1}') ?? -1).toList();
  }

  List<int> _getLegalMoves() {
    final raw = widget.ludoState['legalMoves'];
    if (raw is! List) return [];
    return raw.map<int>((e) => e is int ? e : int.tryParse('$e') ?? -1).where((e) => e >= 0).toList();
  }

  bool get _hasRolled => widget.ludoState['hasRolled'] == true;

  String get _turnMessage {
    final msg = widget.ludoState['turnMessage'];
    return msg is String ? msg : '';
  }

  @override
  Widget build(BuildContext context) {
    final legalMoves = _getLegalMoves();
    return Column(
      children: [
        Expanded(
          child: LayoutBuilder(
            builder: (ctx, constraints) {
              final size = math.min(constraints.maxWidth, constraints.maxHeight);
              return Center(
                child: SizedBox.square(
                  dimension: size,
                  child: _buildBoard(size, legalMoves),
                ),
              );
            },
          ),
        ),
        _buildBottomBar(legalMoves),
      ],
    );
  }

  bool _isSlotActive(int slot) {
    final players = widget.ludoState['players'];
    if (players == null) return slot <= 2;
    return players['$slot'] != null || players[slot] != null;
  }

  Widget _buildBoard(double size, List<int> legalMoves) {
    final activeSlots = <int>[];
    for (int s = 1; s <= 4; s++) {
      if (_isSlotActive(s)) {
        activeSlots.add(s);
      }
    }

    return GestureDetector(
      onTapUp: (details) => _onBoardTap(details.localPosition, size, legalMoves),
      child: AnimatedBuilder(
        animation: _pulseAnim,
        builder: (_, __) => CustomPaint(
          painter: _LudoBoardPainter(
            tokenData: _visualSteps,
            activeSlots: activeSlots,
            legalMoves: legalMoves,
            mySlot: widget.mySlot,
            currentSlot: widget.currentSlot,
            hasRolled: _hasRolled,
            myTurn: widget.myTurn,
            pulseValue: _pulseAnim.value,
          ),
          child: const SizedBox.expand(),
        ),
      ),
    );
  }

  void _onBoardTap(Offset pos, double size, List<int> legalMoves) {
    if (!widget.myTurn || widget.gameOver || !_hasRolled) return;
    final cellSize = size / 15.0;
    final col = (pos.dx / cellSize).floor();
    final row = (pos.dy / cellSize).floor();
    final tokens = _visualSteps[widget.mySlot] ?? [];
    for (int i = 0; i < tokens.length; i++) {
      if (!legalMoves.contains(i)) continue;
      final step = tokens[i];
      if (step == -1.0) {
        final spotCenter = _getHomeSpotOffset(widget.mySlot, i, cellSize);
        if ((pos - spotCenter).distance < cellSize * 0.6) {
          widget.onTokenTap(i);
          return;
        }
      } else {
        final cell = _tokenToCell(widget.mySlot, step.round());
        if (cell != null && cell.col == col && cell.row == row) {
          widget.onTokenTap(i);
          return;
        }
      }
    }
  }

  Widget _buildBottomBar(List<int> legalMoves) {
    final bgColor = widget.isDarkMode ? const Color(0xFF0F172A) : Colors.white;
    final borderColor = widget.isDarkMode ? Colors.white10 : Colors.black12;
    final textStyle = TextStyle(
      color: widget.isDarkMode ? Colors.white70 : Colors.black87,
      fontSize: 12,
      fontFamily: 'Outfit',
      fontWeight: FontWeight.w600,
    );

    return Container(
      decoration: BoxDecoration(
        color: bgColor,
        border: Border(top: BorderSide(color: borderColor, width: 1.5)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      child: Row(
        children: [
          _buildDiceFace(_displayedDie),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!_hasRolled && widget.myTurn && !widget.gameOver)
                  _buildGradientButton(
                    label: 'Lancer le dé',
                    icon: Icons.casino_outlined,
                    onTap: _rolling ? null : widget.onRoll,
                  )
                else if (_hasRolled && widget.myTurn && legalMoves.isNotEmpty)
                  Text('Appuyez sur un pion pour le déplacer', style: textStyle)
                else if (!widget.myTurn)
                  Text("Attente de l'adversaire...",
                      style: textStyle.copyWith(color: widget.isDarkMode ? Colors.white38 : Colors.black38))
                else
                  Text('Aucun mouvement possible, tour passé',
                      style: textStyle.copyWith(color: Colors.red.withOpacity(0.8))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDiceFace(int value) {
    // Dice theme adaptation
    final List<Color> colors = _rolling
        ? [const Color(0xFF833AB4), const Color(0xFFFD1D1D)]
        : (widget.isDarkMode
            ? [const Color(0xFF1E293B), const Color(0xFF0F172A)]
            : [const Color(0xFFFFFFFF), const Color(0xFFE2E8F0)]);

    final border = Border.all(
      color: widget.isDarkMode ? Colors.white10 : Colors.white.withOpacity(0.8),
      width: 1.2,
    );

    final dotColor = _rolling
        ? Colors.white
        : (widget.isDarkMode ? Colors.white : const Color(0xFF1E293B));

    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: _rolling
                ? const Color(0xFFFD1D1D).withOpacity(0.35)
                : Colors.black.withOpacity(widget.isDarkMode ? 0.4 : 0.15),
            blurRadius: 6,
            offset: const Offset(0, 3),
          ),
          if (!widget.isDarkMode)
            BoxShadow(
              color: Colors.white.withOpacity(0.9),
              blurRadius: 1.5,
              offset: const Offset(-1.5, -1.5),
            ),
        ],
        border: border,
      ),
      child: Center(
        child: _DiceDots(
          value: value,
          color: dotColor,
        ),
      ),
    );
  }

  Widget _buildGradientButton({required String label, required IconData icon, VoidCallback? onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 44,
        decoration: BoxDecoration(
          gradient: onTap == null ? null : const LinearGradient(
            colors: [Color(0xFF833AB4), Color(0xFFC13584), Color(0xFFE1306C), Color(0xFFFD1D1D)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          color: onTap == null ? Colors.grey.shade800 : null,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: Colors.white, size: 18),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid cell helper
// ─────────────────────────────────────────────────────────────────────────────
class _Cell {
  final int row;
  final int col;
  const _Cell(this.row, this.col);
}

_Cell? _tokenToCell(int slot, int step) {
  if (step == -1) return null;
  if (step >= _kFinalStep) return null;
  if (step >= 52) {
    final idx = step - 52;
    return switch (slot) {
      1 => _Cell(7, 1 + idx),
      2 => _Cell(1 + idx, 7),
      3 => _Cell(7, 13 - idx),
      4 => _Cell(13 - idx, 7),
      _ => null,
    };
  }
  final globalIdx = (_kStartIndices[slot]! + step) % _kLoopLength;
  return _kGlobalToCell[globalIdx];
}

const _kGlobalToCell = <int, _Cell>{
  0:  _Cell(6, 1),  1:  _Cell(6, 2),  2:  _Cell(6, 3),  3:  _Cell(6, 4),
  4:  _Cell(6, 5),  5:  _Cell(5, 6),  6:  _Cell(4, 6),  7:  _Cell(3, 6),
  8:  _Cell(2, 6),  9:  _Cell(1, 6), 10:  _Cell(0, 6), 11:  _Cell(0, 7),
  12: _Cell(0, 8), 13:  _Cell(1, 8), 14:  _Cell(2, 8), 15:  _Cell(3, 8),
  16: _Cell(4, 8), 17:  _Cell(5, 8), 18:  _Cell(6, 9), 19:  _Cell(6,10),
  20: _Cell(6,11), 21:  _Cell(6,12), 22:  _Cell(6,13), 23:  _Cell(6,14),
  24: _Cell(7,14), 25:  _Cell(8,14), 26:  _Cell(8,13), 27:  _Cell(8,12),
  28: _Cell(8,11), 29:  _Cell(8,10), 30:  _Cell(8, 9), 31:  _Cell(9, 8),
  32: _Cell(10, 8),33: _Cell(11, 8), 34: _Cell(12, 8), 35: _Cell(13, 8),
  36: _Cell(14, 8),37: _Cell(14, 7), 38: _Cell(14, 6), 39: _Cell(13, 6),
  40: _Cell(12, 6),41: _Cell(11, 6), 42: _Cell(10, 6), 43: _Cell(9, 6),
  44: _Cell(8, 5), 45:  _Cell(8, 4), 46:  _Cell(8, 3), 47:  _Cell(8, 2),
  48: _Cell(8, 1), 49:  _Cell(7, 0), 50:  _Cell(6, 0), 51:  _Cell(7, 1),
};

// ─────────────────────────────────────────────────────────────────────────────
// CustomPainter
// ─────────────────────────────────────────────────────────────────────────────
class _LudoBoardPainter extends CustomPainter {
  final Map<int, List<double>> tokenData;
  final List<int> activeSlots;
  final List<int> legalMoves;
  final int mySlot;
  final int currentSlot;
  final bool hasRolled;
  final bool myTurn;
  final double pulseValue;

  const _LudoBoardPainter({
    required this.tokenData,
    required this.activeSlots,
    required this.legalMoves,
    required this.mySlot,
    required this.currentSlot,
    required this.hasRolled,
    required this.myTurn,
    required this.pulseValue,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final cs = size.width / 15.0;
    _drawBackground(canvas, size, cs);
    _drawSafeStars(canvas, cs);
    _drawTokens(canvas, cs);
  }

  void _drawBackground(Canvas canvas, Size size, double cs) {
    final borderR = Radius.circular(cs * 0.7);
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, size.width, size.height), borderR),
      Paint()..color = const Color(0xFF0D0D1A),
    );

    // Board outer border
    final borderPaint = Paint()
      ..color = Colors.white.withOpacity(0.15)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, size.width, size.height), borderR),
      borderPaint,
    );

    final homeZones = <int, Rect>{
      1: Rect.fromLTWH(0, 0, cs * 6, cs * 6),
      2: Rect.fromLTWH(cs * 9, 0, cs * 6, cs * 6),
      3: Rect.fromLTWH(cs * 9, cs * 9, cs * 6, cs * 6),
      4: Rect.fromLTWH(0, cs * 9, cs * 6, cs * 6),
    };
    final outerRadius = cs * 0.7;
    final innerRadius = cs * 0.45;

    for (final e in homeZones.entries) {
      final slot = e.key;
      final rect = e.value;
      final color = _kColors[slot]!;

      // Build zone RRect rounding only the respective outer corner
      final RRect zoneRRect = switch (slot) {
        1 => RRect.fromRectAndCorners(rect, topLeft: Radius.circular(outerRadius)),
        2 => RRect.fromRectAndCorners(rect, topRight: Radius.circular(outerRadius)),
        3 => RRect.fromRectAndCorners(rect, bottomRight: Radius.circular(outerRadius)),
        4 => RRect.fromRectAndCorners(rect, bottomLeft: Radius.circular(outerRadius)),
        _ => RRect.fromRectAndRadius(rect, Radius.zero),
      };

      canvas.drawRRect(zoneRRect, Paint()..color = color.withOpacity(0.18));

      // Build yard RRect rounding only the respective outer corner
      final yard = rect.deflate(cs * 0.5);
      final RRect yardRRect = switch (slot) {
        1 => RRect.fromRectAndCorners(yard, topLeft: Radius.circular(innerRadius)),
        2 => RRect.fromRectAndCorners(yard, topRight: Radius.circular(innerRadius)),
        3 => RRect.fromRectAndCorners(yard, bottomRight: Radius.circular(innerRadius)),
        4 => RRect.fromRectAndCorners(yard, bottomLeft: Radius.circular(innerRadius)),
        _ => RRect.fromRectAndRadius(yard, Radius.zero),
      };

      canvas.drawRRect(yardRRect, Paint()..color = color.withOpacity(0.35));
      canvas.drawRRect(
        yardRRect,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }

    final trackPaint = Paint()..color = Colors.white.withOpacity(0.05);
    final trackBorder = Paint()..color = Colors.white.withOpacity(0.1)..style = PaintingStyle.stroke..strokeWidth = 0.5;
    for (final cell in _kGlobalToCell.values) {
      final rect = _cellRect(cell, cs);
      canvas.drawRect(rect, trackPaint);
      canvas.drawRect(rect, trackBorder);
    }

    // Start squares
    final starts = {1: _Cell(6, 1), 2: _Cell(1, 8), 3: _Cell(8, 13), 4: _Cell(13, 6)};
    for (final e in starts.entries) {
      canvas.drawRect(_cellRect(e.value, cs), Paint()..color = _kColors[e.key]!.withOpacity(0.7));
    }

    // Home stretches
    final stretches = <int, List<_Cell>>{
      1: [_Cell(7,1),_Cell(7,2),_Cell(7,3),_Cell(7,4),_Cell(7,5)],
      2: [_Cell(1,7),_Cell(2,7),_Cell(3,7),_Cell(4,7),_Cell(5,7)],
      3: [_Cell(7,9),_Cell(7,10),_Cell(7,11),_Cell(7,12),_Cell(7,13)],
      4: [_Cell(9,7),_Cell(10,7),_Cell(11,7),_Cell(12,7),_Cell(13,7)],
    };
    for (final e in stretches.entries) {
      for (final cell in e.value) {
        canvas.drawRect(_cellRect(cell, cs), Paint()..color = _kColors[e.key]!.withOpacity(0.45));
      }
    }

    // Draw 4 centered home circles/spots in each home yard for active slots
    for (int slot in activeSlots) {
      final color = _kColors[slot]!;
      for (int i = 0; i < 4; i++) {
        final center = _getHomeSpotOffset(slot, i, cs);
        final r = cs * 0.4;
        // Background of spot
        canvas.drawCircle(center, r, Paint()..color = Colors.white.withOpacity(0.12));
        // Border of spot
        canvas.drawCircle(
          center,
          r,
          Paint()
            ..color = color.withOpacity(0.5)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.5,
        );
      }
    }

    // Draw entry arrows pointing to home stretches for active slots
    final arrowPaint = Paint()..style = PaintingStyle.fill;
    
    if (activeSlots.contains(1)) {
      arrowPaint.color = _kColors[1]!;
      _drawArrow(canvas, _cellRect(const _Cell(7, 0), cs), 'right', arrowPaint);
    }
    if (activeSlots.contains(2)) {
      arrowPaint.color = _kColors[2]!;
      _drawArrow(canvas, _cellRect(const _Cell(0, 7), cs), 'down', arrowPaint);
    }
    if (activeSlots.contains(3)) {
      arrowPaint.color = _kColors[3]!;
      _drawArrow(canvas, _cellRect(const _Cell(7, 14), cs), 'left', arrowPaint);
    }
    if (activeSlots.contains(4)) {
      arrowPaint.color = _kColors[4]!;
      _drawArrow(canvas, _cellRect(const _Cell(14, 7), cs), 'up', arrowPaint);
    }

    // Center diamond
    final cx = cs * 7.5;
    final cy = cs * 7.5;
    final centerRect = Rect.fromLTWH(cs * 6, cs * 6, cs * 3, cs * 3);
    final triColors = [_kColors[2]!, _kColors[3]!, _kColors[4]!, _kColors[1]!];
    final corners = [centerRect.topLeft, centerRect.topRight, centerRect.bottomRight, centerRect.bottomLeft];
    for (int t = 0; t < 4; t++) {
      final path = Path()
        ..moveTo(corners[t].dx, corners[t].dy)
        ..lineTo(cx, cy)
        ..lineTo(corners[(t + 1) % 4].dx, corners[(t + 1) % 4].dy)
        ..close();
      canvas.drawPath(path, Paint()..color = triColors[t].withOpacity(0.7));
    }
    _drawStar(canvas, Offset(cx, cy), cs * 0.4, Colors.white.withOpacity(0.85));
  }

  void _drawSafeStars(Canvas canvas, double cs) {
    for (final gi in _kSafeGlobalIndices) {
      final cell = _kGlobalToCell[gi];
      if (cell == null) continue;
      _drawSafeZone(canvas, _cellRect(cell, cs).center, cs);
    }
  }

  void _drawSafeZone(Canvas canvas, Offset center, double cs) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.35)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8;
    final r = cs * 0.28;
    
    final path = Path()
      ..moveTo(center.dx - r * 0.8, center.dy - r * 0.8)
      ..lineTo(center.dx + r * 0.8, center.dy - r * 0.8)
      ..lineTo(center.dx + r * 0.8, center.dy - r * 0.2)
      ..quadraticBezierTo(center.dx + r * 0.8, center.dy + r * 0.6, center.dx, center.dy + r * 0.95)
      ..quadraticBezierTo(center.dx - r * 0.8, center.dy + r * 0.6, center.dx - r * 0.8, center.dy - r * 0.2)
      ..close();
    
    canvas.drawPath(path, paint);
    
    // Draw a small star inside the safe zone shield
    _drawStar(canvas, center, r * 0.35, Colors.white.withOpacity(0.2));
  }

  void _drawArrow(Canvas canvas, Rect rect, String direction, Paint paint) {
    final path = Path();
    final w = rect.width;
    final h = rect.height;
    final l = rect.left;
    final t = rect.top;
    
    if (direction == 'right') {
      path.moveTo(l + w * 0.15, t + h * 0.35);
      path.lineTo(l + w * 0.55, t + h * 0.35);
      path.lineTo(l + w * 0.55, t + h * 0.15);
      path.lineTo(l + w * 0.85, t + h * 0.5);
      path.lineTo(l + w * 0.55, t + h * 0.85);
      path.lineTo(l + w * 0.55, t + h * 0.65);
      path.lineTo(l + w * 0.15, t + h * 0.65);
    } else if (direction == 'down') {
      path.moveTo(l + w * 0.35, t + h * 0.15);
      path.lineTo(l + w * 0.35, t + h * 0.55);
      path.lineTo(l + w * 0.15, t + h * 0.55);
      path.lineTo(l + w * 0.5, t + h * 0.85);
      path.lineTo(l + w * 0.85, t + h * 0.55);
      path.lineTo(l + w * 0.65, t + h * 0.55);
      path.lineTo(l + w * 0.65, t + h * 0.15);
    } else if (direction == 'left') {
      path.moveTo(l + w * 0.85, t + h * 0.35);
      path.lineTo(l + w * 0.45, t + h * 0.35);
      path.lineTo(l + w * 0.45, t + h * 0.15);
      path.lineTo(l + w * 0.15, t + h * 0.5);
      path.lineTo(l + w * 0.45, t + h * 0.85);
      path.lineTo(l + w * 0.45, t + h * 0.65);
      path.lineTo(l + w * 0.85, t + h * 0.65);
    } else if (direction == 'up') {
      path.moveTo(l + w * 0.35, t + h * 0.85);
      path.lineTo(l + w * 0.35, t + h * 0.45);
      path.lineTo(l + w * 0.15, t + h * 0.45);
      path.lineTo(l + w * 0.5, t + h * 0.15);
      path.lineTo(l + w * 0.85, t + h * 0.45);
      path.lineTo(l + w * 0.65, t + h * 0.45);
      path.lineTo(l + w * 0.65, t + h * 0.85);
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  void _drawStar(Canvas canvas, Offset center, double radius, Color color) {
    final path = Path();
    for (int i = 0; i < 10; i++) {
      final r = i.isEven ? radius : radius * 0.5;
      final angle = (i * math.pi / 5) - math.pi / 2;
      final pt = Offset(center.dx + r * math.cos(angle), center.dy + r * math.sin(angle));
      i == 0 ? path.moveTo(pt.dx, pt.dy) : path.lineTo(pt.dx, pt.dy);
    }
    path.close();
    canvas.drawPath(path, Paint()..color = color);
  }

  Offset? _getTokenOffset(int slot, double visualStep, int tokenIdx, double cs) {
    if (visualStep == -1.0) {
      return _getHomeSpotOffset(slot, tokenIdx, cs);
    }
    if (visualStep >= _kFinalStep) {
      // Draw finished tokens stacked in the central triangle
      final cx = cs * 7.5;
      final cy = cs * 7.5;
      final offset = (tokenIdx - 1.5) * cs * 0.22; // spread finished stars slightly
      return switch (slot) {
        1 => Offset(cx - cs * 0.8, cy + offset),
        2 => Offset(cx + offset, cy - cs * 0.8),
        3 => Offset(cx + cs * 0.8, cy + offset),
        4 => Offset(cx + offset, cy + cs * 0.8),
        _ => Offset(cx, cy),
      };
    }

    if (visualStep < 0.0) {
      final homePos = _getHomeSpotOffset(slot, tokenIdx, cs);
      final cell0 = _tokenToCell(slot, 0);
      if (cell0 == null) return homePos;
      final startPos = _cellRect(cell0, cs).center;
      final fraction = visualStep + 1.0;
      return Offset(
        homePos.dx + (startPos.dx - homePos.dx) * fraction,
        homePos.dy + (startPos.dy - homePos.dy) * fraction,
      );
    }

    final int baseStep = visualStep.floor();
    final double fraction = visualStep - baseStep;

    final cell1 = _tokenToCell(slot, baseStep);
    if (cell1 == null) return null;
    final pos1 = _cellRect(cell1, cs).center;

    if (fraction == 0.0 || baseStep + 1 >= _kFinalStep) {
      return pos1;
    }

    final cell2 = _tokenToCell(slot, baseStep + 1);
    if (cell2 == null) return pos1;
    final pos2 = _cellRect(cell2, cs).center;

    return Offset(
      pos1.dx + (pos2.dx - pos1.dx) * fraction,
      pos1.dy + (pos2.dy - pos1.dy) * fraction,
    );
  }

  void _drawTokens(Canvas canvas, double cs) {
    final pulse = 0.75 + pulseValue * 0.25;
    for (final entry in tokenData.entries) {
      final slot = entry.key;
      if (!activeSlots.contains(slot)) continue;

      final tokens = entry.value;
      final color = _kColors[slot]!;
      for (int i = 0; i < tokens.length; i++) {
        final step = tokens[i];

        final center = _getTokenOffset(slot, step, i, cs);
        if (center == null) continue;

        final isLegal = myTurn && hasRolled && slot == mySlot && legalMoves.contains(i);
        _drawToken(canvas, center, cs, color, i, isLegal, pulse);
      }
    }
  }

  void _drawToken(Canvas canvas, Offset center, double cs, Color color, int idx, bool isLegal, double pulse) {
    final r = cs * 0.35;
    if (isLegal) {
      // Glow ring around the star
      canvas.drawCircle(
        center,
        r * 1.5 * pulse,
        Paint()
          ..color = Colors.white.withOpacity(0.4 * pulse)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.0,
      );
    }

    // Shadow
    final shadowPaint = Paint()..color = Colors.black38;
    final starPaint = Paint()..color = color;
    final borderPaint = Paint()
      ..color = Colors.white.withOpacity(0.9)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8;

    // Draw shadow star offset
    _drawStarPath(canvas, center + const Offset(1.5, 1.5), r, shadowPaint);

    // Draw main colored star
    _drawStarPath(canvas, center, r, starPaint);

    // Draw white border
    _drawStarPath(canvas, center, r, borderPaint);
  }

  void _drawStarPath(Canvas canvas, Offset center, double radius, Paint paint) {
    final path = Path();
    for (int i = 0; i < 10; i++) {
      final r = i.isEven ? radius : radius * 0.42;
      final angle = (i * math.pi / 5) - math.pi / 2;
      final pt = Offset(center.dx + r * math.cos(angle), center.dy + r * math.sin(angle));
      i == 0 ? path.moveTo(pt.dx, pt.dy) : path.lineTo(pt.dx, pt.dy);
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  Rect _cellRect(_Cell cell, double cs) =>
      Rect.fromLTWH(cell.col * cs, cell.row * cs, cs, cs);

  @override
  bool shouldRepaint(covariant _LudoBoardPainter old) =>
      old.tokenData != tokenData || old.legalMoves != legalMoves ||
      old.hasRolled != hasRolled || old.myTurn != myTurn || old.pulseValue != pulseValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dice Dots Widget
// ─────────────────────────────────────────────────────────────────────────────
class _DiceDots extends StatelessWidget {
  final int value;
  final Color color;
  const _DiceDots({required this.value, required this.color});

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: const Size(28, 28), painter: _DiceDotsPainter(value: value, color: color));
}

class _DiceDotsPainter extends CustomPainter {
  final int value;
  final Color color;
  const _DiceDotsPainter({required this.value, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final r = size.width * 0.09;
    final c = size.width / 2;
    final q1 = size.width * 0.28;
    final q3 = size.width * 0.72;
    final positions = <int, List<Offset>>{
      1: [Offset(c, c)],
      2: [Offset(q1, q1), Offset(q3, q3)],
      3: [Offset(q1, q1), Offset(c, c), Offset(q3, q3)],
      4: [Offset(q1, q1), Offset(q3, q1), Offset(q1, q3), Offset(q3, q3)],
      5: [Offset(q1, q1), Offset(q3, q1), Offset(c, c), Offset(q1, q3), Offset(q3, q3)],
      6: [Offset(q1, q1), Offset(q3, q1), Offset(q1, c), Offset(q3, c), Offset(q1, q3), Offset(q3, q3)],
    };
    for (final pos in positions[value] ?? []) {
      canvas.drawCircle(pos, r, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _DiceDotsPainter old) => old.value != value || old.color != color;
}

// Helper function to calculate centered home spots mathematically
Offset _getHomeSpotOffset(int slot, int index, double cs) {
  final Offset yardCenter = switch (slot) {
    1 => Offset(3.0 * cs, 3.0 * cs),
    2 => Offset(12.0 * cs, 3.0 * cs),
    3 => Offset(12.0 * cs, 12.0 * cs),
    4 => Offset(3.0 * cs, 12.0 * cs),
    _ => Offset.zero,
  };

  final double d = 1.1 * cs;
  return switch (index) {
    0 => Offset(yardCenter.dx - d, yardCenter.dy - d),
    1 => Offset(yardCenter.dx + d, yardCenter.dy - d),
    2 => Offset(yardCenter.dx - d, yardCenter.dy + d),
    3 => Offset(yardCenter.dx + d, yardCenter.dy + d),
    _ => yardCenter,
  };
}
