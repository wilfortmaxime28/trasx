import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

// Physics constants
const double PUCK_RADIUS = 16.0;
const double BALL_RADIUS = 8.5;
const double PUCK_MASS = 12.0;
const double BALL_MASS = 2.0;
const double FRICTION = 0.983;
const double RESTITUTION = -0.75;

// Pitch bounds
const double FIELD_MIN_X = 30.0;
const double FIELD_MAX_X = 330.0;
const double FIELD_MIN_Y = 40.0;
const double FIELD_MAX_Y = 560.0;
const double GOAL_MIN_X = 130.0;
const double GOAL_MAX_X = 230.0;

class TableFootballBoard extends StatefulWidget {
  final Map<String, dynamic> game;
  final int mySlot;
  final int currentSlot;
  final bool myTurn;
  final bool gameOver;
  final bool isDarkMode;
  final String gameId;
  final Function(Map<String, dynamic> movePayload) onSync;
  final Function(int puckIndex, double vx, double vy) onShot;

  const TableFootballBoard({
    super.key,
    required this.game,
    required this.mySlot,
    required this.currentSlot,
    required this.myTurn,
    required this.gameOver,
    required this.isDarkMode,
    required this.gameId,
    required this.onSync,
    required this.onShot,
  });

  @override
  State<TableFootballBoard> createState() => _TableFootballBoardState();
}

class _TableFootballBoardState extends State<TableFootballBoard> with SingleTickerProviderStateMixin {
  late List<_Puck> _p1;
  late List<_Puck> _p2;
  late _Puck _ball;

  bool _isSimulating = false;
  Ticker? _ticker;

  // Drag aiming
  int? _draggedPuckIndex;
  Offset? _dragStart;
  Offset? _dragCurrent;

  // Team flags
  String _team1 = 'FR';
  String _team2 = 'BR';

  // Real-time local scores
  final Map<String, int> _scores = {'1': 0, '2': 0};

  // Last processed play timestamp to avoid duplicate shot impulses
  String? _lastPlaySignature;

  @override
  void initState() {
    super.initState();
    _initPositionsFromState();
    _ticker = createTicker(_tickPhysics);
  }

  @override
  void dispose() {
    _ticker?.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant TableFootballBoard oldWidget) {
    super.didUpdateWidget(oldWidget);

    // Sync from server if not simulating
    if (!_isSimulating) {
      _initPositionsFromState();
    }

    // Check if opponent shot
    final tfState = widget.game['tableFootballState'];
    if (tfState is Map) {
      final lastPlay = tfState['lastPlay'];
      if (lastPlay is Map) {
        final playSig = "${lastPlay['playerSlot']}_${lastPlay['puckIndex']}_${lastPlay['vx']}_${lastPlay['vy']}";
        if (playSig != _lastPlaySignature) {
          _lastPlaySignature = playSig;
          
          final int slot = lastPlay['playerSlot'] is int 
              ? lastPlay['playerSlot'] 
              : int.tryParse('${lastPlay['playerSlot']}') ?? 1;

          // If the shot was from the opponent, trigger local simulation
          if (slot != widget.mySlot) {
            final int puckIndex = lastPlay['puckIndex'] is int 
                ? lastPlay['puckIndex'] 
                : int.tryParse('${lastPlay['puckIndex']}') ?? 0;
            final double vx = (lastPlay['vx'] is num) ? (lastPlay['vx'] as num).toDouble() : 0.0;
            final double vy = (lastPlay['vy'] is num) ? (lastPlay['vy'] as num).toDouble() : 0.0;

            _applyImpulse(slot, puckIndex, vx, vy);
          }
        }
      }
    }
  }

  void _initPositionsFromState() {
    _team1 = widget.game['team1']?.toString() ?? 'FR';
    _team2 = widget.game['team2']?.toString() ?? 'BR';

    final tfState = widget.game['tableFootballState'];
    if (tfState is Map) {
      final scoresMap = tfState['scores'];
      if (scoresMap is Map) {
        _scores['1'] = int.tryParse('${scoresMap['1']}') ?? 0;
        _scores['2'] = int.tryParse('${scoresMap['2']}') ?? 0;
      }
    }

    if (tfState is Map && tfState['positions'] is Map) {
      final pos = tfState['positions'];
      final p1Pos = pos['p1'] as List?;
      final p2Pos = pos['p2'] as List?;
      final ballPos = pos['ball'] as Map?;

      if (p1Pos != null && p2Pos != null && ballPos != null) {
        _p1 = List.generate(6, (i) {
          final m = p1Pos[i] as Map;
          return _Puck(
            x: (m['x'] as num).toDouble(),
            y: (m['y'] as num).toDouble(),
            vx: 0,
            vy: 0,
            radius: PUCK_RADIUS,
            mass: PUCK_MASS,
            isBall: false,
            team: 1,
            index: i,
          );
        });

        _p2 = List.generate(6, (i) {
          final m = p2Pos[i] as Map;
          return _Puck(
            x: (m['x'] as num).toDouble(),
            y: (m['y'] as num).toDouble(),
            vx: 0,
            vy: 0,
            radius: PUCK_RADIUS,
            mass: PUCK_MASS,
            isBall: false,
            team: 2,
            index: i,
          );
        });

        _ball = _Puck(
          x: (ballPos['x'] as num).toDouble(),
          y: (ballPos['y'] as num).toDouble(),
          vx: 0,
          vy: 0,
          radius: BALL_RADIUS,
          mass: BALL_MASS,
          isBall: true,
          team: 0,
          index: 0,
        );
      }
    } else {
      // Fallback defaults
      _p1 = [
        _Puck(x: 180, y: 55, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 0),
        _Puck(x: 100, y: 120, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 1),
        _Puck(x: 260, y: 120, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 2),
        _Puck(x: 180, y: 200, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 3),
        _Puck(x: 110, y: 260, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 4),
        _Puck(x: 250, y: 260, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 5),
      ];
      _p2 = [
        _Puck(x: 180, y: 545, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 0),
        _Puck(x: 100, y: 480, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 1),
        _Puck(x: 260, y: 480, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 2),
        _Puck(x: 180, y: 400, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 3),
        _Puck(x: 110, y: 340, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 4),
        _Puck(x: 250, y: 340, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 5),
      ];
      _ball = _Puck(x: 180, y: 300, radius: BALL_RADIUS, mass: BALL_MASS, isBall: true, team: 0, index: 0);
    }
  }

  void _applyImpulse(int slot, int index, double vx, double vy) {
    setState(() {
      if (slot == 1 && index < _p1.length) {
        _p1[index].vx = vx;
        _p1[index].vy = vy;
      } else if (slot == 2 && index < _p2.length) {
        _p2[index].vx = vx;
        _p2[index].vy = vy;
      }
      _isSimulating = true;
    });
    _ticker?.start();
  }

  void _triggerGoalReset() {
    _ticker?.stop();
    _isSimulating = false;

    // Reset coordinates to kickoff defaults
    _p1 = [
      _Puck(x: 180, y: 55, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 0),
      _Puck(x: 100, y: 120, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 1),
      _Puck(x: 260, y: 120, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 2),
      _Puck(x: 180, y: 200, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 3),
      _Puck(x: 110, y: 260, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 4),
      _Puck(x: 250, y: 260, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 1, index: 5),
    ];
    _p2 = [
      _Puck(x: 180, y: 545, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 0),
      _Puck(x: 100, y: 480, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 1),
      _Puck(x: 260, y: 480, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 2),
      _Puck(x: 180, y: 400, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 3),
      _Puck(x: 110, y: 340, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 4),
      _Puck(x: 250, y: 340, radius: PUCK_RADIUS, mass: PUCK_MASS, isBall: false, team: 2, index: 5),
    ];
    _ball = _Puck(x: 180, y: 300, radius: BALL_RADIUS, mass: BALL_MASS, isBall: true, team: 0, index: 0);

    setState(() {});

    // Sync new scores and positions to server immediately!
    final statePayload = {
      'positions': {
        'p1': _p1.map((p) => {'x': p.x, 'y': p.y}).toList(),
        'p2': _p2.map((p) => {'x': p.x, 'y': p.y}).toList(),
        'ball': {'x': _ball.x, 'y': _ball.y}
      },
      'scores': {
        '1': _scores['1'] ?? 0,
        '2': _scores['2'] ?? 0
      }
    };
    widget.onSync(statePayload);
  }

  void _tickPhysics(Duration elapsed) {
    if (!mounted) return;

    bool moving = false;
    final all = [..._p1, ..._p2, _ball];

    // 1. Update positions & friction
    for (final p in all) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      if (p.vx.abs() < 0.05) p.vx = 0;
      if (p.vy.abs() < 0.05) p.vy = 0;
      if (p.vx != 0 || p.vy != 0) {
        moving = true;
      }
    }

    // 2. Wall bounces
    for (final p in all) {
      // X bounds
      if (p.x < FIELD_MIN_X + p.radius) {
        p.x = FIELD_MIN_X + p.radius;
        p.vx *= RESTITUTION;
      } else if (p.x > FIELD_MAX_X - p.radius) {
        p.x = FIELD_MAX_X - p.radius;
        p.vx *= RESTITUTION;
      }

      // Y bounds (Goal check)
      if (p.y < FIELD_MIN_Y + p.radius) {
        if (p.x >= GOAL_MIN_X && p.x <= GOAL_MAX_X) {
          if (p.y < 20 + p.radius) {
            p.y = 20 + p.radius;
            p.vy *= RESTITUTION;
            if (p.isBall) {
              // Ball in top goal: P2 (Blue) scores!
              _scores['2'] = (_scores['2'] ?? 0) + 1;
              _triggerGoalReset();
              return;
            }
          }
        } else {
          p.y = FIELD_MIN_Y + p.radius;
          p.vy *= RESTITUTION;
        }
      } else if (p.y > FIELD_MAX_Y - p.radius) {
        if (p.x >= GOAL_MIN_X && p.x <= GOAL_MAX_X) {
          if (p.y > 580 - p.radius) {
            p.y = 580 - p.radius;
            p.vy *= RESTITUTION;
            if (p.isBall) {
              // Ball in bottom goal: P1 (Red) scores!
              _scores['1'] = (_scores['1'] ?? 0) + 1;
              _triggerGoalReset();
              return;
            }
          }
        } else {
          p.y = FIELD_MAX_Y - p.radius;
          p.vy *= RESTITUTION;
        }
      }
    }

    // 3. Puck to Puck and Puck to Ball elastic collisions
    for (int i = 0; i < all.length; i++) {
      for (int j = i + 1; j < all.length; j++) {
        final p1 = all[i];
        final p2 = all[j];

        final double dx = p2.x - p1.x;
        final double dy = p2.y - p1.y;
        final double dist = math.sqrt(dx * dx + dy * dy);
        final double minDist = p1.radius + p2.radius;

        if (dist < minDist && dist > 0.01) {
          final double overlap = minDist - dist;
          final double nx = dx / dist;
          final double ny = dy / dist;

          // Resolve overlap
          final double totalMass = p1.mass + p2.mass;
          final double p1Ratio = p2.mass / totalMass;
          final double p2Ratio = p1.mass / totalMass;

          p1.x -= nx * overlap * p1Ratio;
          p1.y -= ny * overlap * p1Ratio;
          p2.x += nx * overlap * p2Ratio;
          p2.y += ny * overlap * p2Ratio;

          // Normal relative velocity
          final double kx = p1.vx - p2.vx;
          final double ky = p1.vy - p2.vy;
          final double vn = kx * nx + ky * ny;

          if (vn > 0) {
            final double impulse = (2.0 * vn) / totalMass;
            p1.vx -= nx * impulse * p2.mass;
            p1.vy -= ny * impulse * p2.mass;
            p2.vx += nx * impulse * p1.mass;
            p2.vy += ny * impulse * p1.mass;
          }
        }
      }
    }

    setState(() {});

    // Check if stopped
    if (!moving) {
      _ticker?.stop();
      _isSimulating = false;

      // Only the shooter sends sync to avoid double sends
      if (widget.myTurn && !widget.gameOver) {
        final statePayload = {
          'positions': {
            'p1': _p1.map((p) => {'x': p.x, 'y': p.y}).toList(),
            'p2': _p2.map((p) => {'x': p.x, 'y': p.y}).toList(),
            'ball': {'x': _ball.x, 'y': _ball.y}
          },
          'scores': widget.game['tableFootballState']?['scores'] ?? {'1': 0, '2': 0}
        };

        widget.onSync(statePayload);
      }
    }
  }

  void _onPanStart(DragStartDetails details, BoxConstraints constraints) {
    if (!widget.myTurn || widget.gameOver || _isSimulating) return;

    final RenderBox renderBox = context.findRenderObject() as RenderBox;
    final localPos = renderBox.globalToLocal(details.globalPosition);

    final scale = constraints.maxWidth / 360.0;
    final double vx = localPos.dx / scale;
    final double vy = localPos.dy / scale;

    final myTeamPucks = widget.mySlot == 1 ? _p1 : _p2;

    for (int i = 0; i < myTeamPucks.length; i++) {
      final p = myTeamPucks[i];
      final distSqr = (vx - p.x) * (vx - p.x) + (vy - p.y) * (vy - p.y);
      if (distSqr <= (PUCK_RADIUS * PUCK_RADIUS * 1.5)) {
        setState(() {
          _draggedPuckIndex = i;
          _dragStart = Offset(p.x, p.y);
          _dragCurrent = Offset(vx, vy);
        });
        break;
      }
    }
  }

  void _onPanUpdate(DragUpdateDetails details, BoxConstraints constraints) {
    if (_draggedPuckIndex == null) return;

    final RenderBox renderBox = context.findRenderObject() as RenderBox;
    final localPos = renderBox.globalToLocal(details.globalPosition);

    final scale = constraints.maxWidth / 360.0;
    final double vx = localPos.dx / scale;
    final double vy = localPos.dy / scale;

    setState(() {
      _dragCurrent = Offset(
        vx.clamp(FIELD_MIN_X, FIELD_MAX_X),
        vy.clamp(FIELD_MIN_Y, FIELD_MAX_Y),
      );
    });
  }

  void _onPanEnd(DragEndDetails details) {
    if (_draggedPuckIndex == null || _dragStart == null || _dragCurrent == null) return;

    final double dx = _dragStart!.dx - _dragCurrent!.dx;
    final double dy = _dragStart!.dy - _dragCurrent!.dy;
    final double dist = math.sqrt(dx * dx + dy * dy);

    if (dist > 5) {
      final double clampedDist = math.min(dist, 100.0);
      final double angle = math.atan2(dy, dx);

      // Convert vector to impulse velocity
      final double vx = math.cos(angle) * clampedDist * 0.16;
      final double vy = math.sin(angle) * clampedDist * 0.16;

      widget.onShot(_draggedPuckIndex!, vx, vy);
      _applyImpulse(widget.mySlot, _draggedPuckIndex!, vx, vy);
    }

    setState(() {
      _draggedPuckIndex = null;
      _dragStart = null;
      _dragCurrent = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return GestureDetector(
          onPanStart: (d) => _onPanStart(d, constraints),
          onPanUpdate: (d) => _onPanUpdate(d, constraints),
          onPanEnd: _onPanEnd,
          child: AspectRatio(
            aspectRatio: 0.6,
            child: CustomPaint(
              painter: _PitchPainter(
                p1: _p1,
                p2: _p2,
                ball: _ball,
                team1: _team1,
                team2: _team2,
                draggedIndex: _draggedPuckIndex,
                dragStart: _dragStart,
                dragCurrent: _dragCurrent,
                mySlot: widget.mySlot,
              ),
              child: const SizedBox.expand(),
            ),
          ),
        );
      },
    );
  }
}

class _Puck {
  double x;
  double y;
  double vx;
  double vy;
  final double radius;
  final double mass;
  final bool isBall;
  final int team;
  final int index;

  _Puck({
    required this.x,
    required this.y,
    this.vx = 0,
    this.vy = 0,
    required this.radius,
    required this.mass,
    required this.isBall,
    required this.team,
    required this.index,
  });
}

class _PitchPainter extends CustomPainter {
  final List<_Puck> p1;
  final List<_Puck> p2;
  final _Puck ball;
  final String team1;
  final String team2;
  final int? draggedIndex;
  final Offset? dragStart;
  final Offset? dragCurrent;
  final int mySlot;

  _PitchPainter({
    required this.p1,
    required this.p2,
    required this.ball,
    required this.team1,
    required this.team2,
    this.draggedIndex,
    this.dragStart,
    this.dragCurrent,
    required this.mySlot,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 360.0;

    // Helper to scale values
    double sc(double v) => v * scale;
    Offset scOffset(double x, double y) => Offset(x * scale, y * scale);

    // 1. Draw Field Turf
    final turfPaint = Paint()..color = const Color(0xFF14532D);
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), turfPaint);

    // Grass stripes
    final stripePaint = Paint()..color = const Color(0xFF166534);
    final fieldHeight = sc(520);
    final stripeH = fieldHeight / 10;
    final fieldMinY = sc(40);
    for (int i = 0; i < 10; i += 2) {
      canvas.drawRect(
        Rect.fromLTWH(sc(30), fieldMinY + i * stripeH, sc(300), stripeH),
        stripePaint,
      );
    }

    // 2. Spectator Stands (Tribunes) Left and Right
    final tribunePaint = Paint()..color = const Color(0xFF1E293B);
    // Left
    canvas.drawRect(Rect.fromLTWH(0, sc(40), sc(24), sc(520)), tribunePaint);
    // Right
    canvas.drawRect(Rect.fromLTWH(sc(336), sc(40), sc(24), sc(520)), tribunePaint);

    // Benches lines
    final benchPaint = Paint()
      ..color = const Color(0xFF334155)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    for (double y = 45; y < 560; y += 12) {
      canvas.drawLine(scOffset(2, y), scOffset(22, y), benchPaint);
      canvas.drawLine(scOffset(338, y), scOffset(358, y), benchPaint);
    }

    // Stands white barrier borders
    final barrierPaint = Paint()
      ..color = Colors.white24
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawLine(scOffset(25, 40), scOffset(25, 560), barrierPaint);
    canvas.drawLine(scOffset(335, 40), scOffset(335, 560), barrierPaint);

    // 3. Field lines (white)
    final linePaint = Paint()
      ..color = Colors.white.withOpacity(0.6)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0;

    // Midfield line & center circle
    canvas.drawLine(scOffset(30, 300), scOffset(330, 300), linePaint);
    canvas.drawCircle(scOffset(180, 300), sc(45), linePaint);
    canvas.drawCircle(scOffset(180, 300), sc(3.5), Paint()..color = Colors.white.withOpacity(0.8));

    // Outer Pitch Border
    canvas.drawRect(Rect.fromLTRB(sc(30), sc(40), sc(330), sc(560)), linePaint);

    // Goal Areas
    canvas.drawRect(Rect.fromLTRB(sc(90), sc(40), sc(270), sc(105)), linePaint);
    canvas.drawRect(Rect.fromLTRB(sc(130), sc(40), sc(230), sc(65)), linePaint);
    canvas.drawCircle(scOffset(180, 85), sc(2.5), Paint()..color = Colors.white.withOpacity(0.8));

    canvas.drawRect(Rect.fromLTRB(sc(90), sc(495), sc(270), sc(560)), linePaint);
    canvas.drawRect(Rect.fromLTRB(sc(130), sc(535), sc(230), sc(560)), linePaint);
    canvas.drawCircle(scOffset(180, 515), sc(2.5), Paint()..color = Colors.white.withOpacity(0.8));

    // Corner arcs
    canvas.drawArc(Rect.fromCircle(center: scOffset(30, 40), radius: sc(10)), 0, math.pi / 2, false, linePaint);
    canvas.drawArc(Rect.fromCircle(center: scOffset(330, 40), radius: sc(10)), math.pi / 2, math.pi / 2, false, linePaint);
    canvas.drawArc(Rect.fromCircle(center: scOffset(30, 560), radius: sc(10)), -math.pi / 2, math.pi / 2, false, linePaint);
    canvas.drawArc(Rect.fromCircle(center: scOffset(330, 560), radius: sc(10)), math.pi, math.pi / 2, false, linePaint);

    // 4. Goal nets
    final netPaint = Paint()
      ..color = Colors.white12
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    
    // Top Goal net
    for (double x = 130; x <= 230; x += 10) {
      canvas.drawLine(scOffset(x, 40), scOffset(x, 20), netPaint);
    }
    for (double y = 20; y <= 40; y += 5) {
      canvas.drawLine(scOffset(130, y), scOffset(230, y), netPaint);
    }
    // Bottom Goal net
    for (double x = 130; x <= 230; x += 10) {
      canvas.drawLine(scOffset(x, 560), scOffset(x, 580), netPaint);
    }
    for (double y = 560; y <= 580; y += 5) {
      canvas.drawLine(scOffset(130, y), scOffset(230, y), netPaint);
    }

    // Goalposts (white borders)
    final postPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.5;
    canvas.drawPath(
      Path()
        ..moveTo(sc(130), sc(40))
        ..lineTo(sc(130), sc(20))
        ..lineTo(sc(230), sc(20))
        ..lineTo(sc(230), sc(40)),
      postPaint,
    );
    canvas.drawPath(
      Path()
        ..moveTo(sc(130), sc(560))
        ..lineTo(sc(130), sc(580))
        ..lineTo(sc(230), sc(580))
        ..lineTo(sc(230), sc(560)),
      postPaint,
    );

    // 5. Draw Aim Line/Vector
    if (draggedIndex != null && dragStart != null && dragCurrent != null) {
      final origin = dragStart!;
      final double dx = dragStart!.dx - dragCurrent!.dx;
      final double dy = dragStart!.dy - dragCurrent!.dy;
      final double dist = math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        final double clampedDist = math.min(dist, 100.0);
        final double angle = math.atan2(dy, dx);

        final startCenter = scOffset(origin.dx, origin.dy);
        final targetCenter = scOffset(
          origin.dx + math.cos(angle) * clampedDist * 0.95,
          origin.dy + math.sin(angle) * clampedDist * 0.95,
        );

        // Aim line
        canvas.drawLine(
          startCenter,
          targetCenter,
          Paint()
            ..color = const Color(0xFF22D3EE)
            ..strokeWidth = 4.5
            ..strokeCap = StrokeCap.round,
        );

        // Arrow head
        final arrowSize = sc(8);
        final path = Path()
          ..moveTo(targetCenter.dx, targetCenter.dy)
          ..lineTo(
            targetCenter.dx - arrowSize * math.cos(angle - math.pi / 6),
            targetCenter.dy - arrowSize * math.sin(angle - math.pi / 6),
          )
          ..lineTo(
            targetCenter.dx - arrowSize * math.cos(angle + math.pi / 6),
            targetCenter.dy - arrowSize * math.sin(angle + math.pi / 6),
          )
          ..close();
        canvas.drawPath(path, Paint()..color = const Color(0xFF22D3EE));
      }
    }

    // 6. Draw Player pucks
    for (int i = 0; i < p1.length; i++) {
      _drawTeamPuck(canvas, scOffset(p1[i].x, p1[i].y), sc(p1[i].radius), team1, i == 0, 1);
    }
    for (int i = 0; i < p2.length; i++) {
      _drawTeamPuck(canvas, scOffset(p2[i].x, p2[i].y), sc(p2[i].radius), team2, i == 0, 2);
    }

    // 7. Draw Ball
    final bOffset = scOffset(ball.x, ball.y);
    final bRadius = sc(ball.radius);
    // shadow
    canvas.drawCircle(bOffset + const Offset(1, 2), bRadius, Paint()..color = Colors.black45);
    // main body
    canvas.drawCircle(bOffset, bRadius, Paint()..color = Colors.white);
    // seams / detail
    canvas.drawCircle(
      bOffset,
      bRadius,
      Paint()
        ..color = Colors.black26
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.0,
    );
  }

  void _drawTeamPuck(Canvas canvas, Offset center, double radius, String countryCode, bool isGK, int team) {
    // 1. Shadow
    canvas.drawCircle(center + const Offset(0, 2.5), radius, Paint()..color = Colors.black45);

    // 2. Country Flag Emoji centered
    final emojis = {
      'FR': '🇫🇷', 'BR': '🇧🇷', 'AR': '🇦🇷', 'DE': '🇩🇪', 'ES': '🇪🇸',
      'IT': '🇮🇹', 'PT': '🇵🇹', 'GB': '🇬🇧', 'MA': '🇲🇦', 'SN': '🇸🇳',
      'HT': '🇭🇹', 'US': '🇺🇸', 'CA': '🇨🇦', 'BE': '🇧🇪', 'NL': '🇳🇱',
      'ZA': '🇿🇦', 'IE': '🇮🇪', 'CM': '🇨🇲', 'CI': '🇨🇮', 'DZ': '🇩🇿',
      'TN': '🇹🇳', 'EG': '🇪🇬', 'JP': '🇯🇵', 'KR': '🇰🇷', 'SA': '🇸🇦',
    };
    final emoji = emojis[countryCode.toUpperCase()] ?? countryCode;

    // Draw main colored base circle (Red for P1, Blue for P2)
    final basePaint = Paint()..color = (team == 1 ? const Color(0xFFEF4444) : const Color(0xFF3B82F6));
    canvas.drawCircle(center, radius, basePaint);

    // Draw flag inner circle
    canvas.save();
    final clipPath = Path()..addOval(Rect.fromCircle(center: center, radius: radius * 0.85));
    canvas.clipPath(clipPath);

    // Draw the flag emoji using TextPainter
    final textPainter = TextPainter(
      text: TextSpan(
        text: emoji,
        style: TextStyle(
          fontSize: radius * 1.35,
          fontFamily: 'Segoe UI Emoji', // fallback support
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, center - Offset(textPainter.width / 2, textPainter.height / 2));
    canvas.restore();

    // 3. Thick Golden Border for Goalkeeper
    if (isGK) {
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..color = const Color(0xFFFBBF24) // Gold
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5,
      );

      // Gold badge "GK" on top
      final gkPaint = Paint()..color = const Color(0xFFFBBF24);
      canvas.drawCircle(center, radius * 0.35, gkPaint);

      final gkTextPainter = TextPainter(
        text: const TextSpan(
          text: 'GK',
          style: TextStyle(
            color: Color(0xFF1E293B),
            fontWeight: FontWeight.bold,
            fontSize: 7.5,
            fontFamily: 'Outfit',
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      gkTextPainter.layout();
      gkTextPainter.paint(canvas, center - Offset(gkTextPainter.width / 2, gkTextPainter.height / 2));
    } else {
      // Normal thin white border
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..color = Colors.white.withOpacity(0.8)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.2,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _PitchPainter old) =>
      old.p1 != p1 ||
      old.p2 != p2 ||
      old.ball != ball ||
      old.draggedIndex != draggedIndex ||
      old.dragStart != dragStart ||
      old.dragCurrent != dragCurrent;
}
