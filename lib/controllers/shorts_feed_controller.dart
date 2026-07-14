// lib/controllers/shorts_feed_controller.dart
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../services/network_quality_service.dart';

enum ShortsFeedState {
  initialLoading,
  loadingNextPage,
  empty,
  networkError,
  success,
  ended,
}

class ShortsFeedController extends ChangeNotifier {
  final int currentUserId;

  ShortsFeedController({required this.currentUserId});

  final List<dynamic> _reels = [];
  List<dynamic> get reels => _reels;

  ShortsFeedState _state = ShortsFeedState.initialLoading;
  ShortsFeedState get state => _state;

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  bool _hasMore = true;
  bool get hasMore => _hasMore;

  String? _nextCursor;
  String? get nextCursor => _nextCursor;

  Future<void> fetchReels({bool isRefresh = false}) async {
    if (_isLoading) return;
    if (!isRefresh && !_hasMore) return;

    _isLoading = true;
    if (isRefresh) {
      _state = ShortsFeedState.initialLoading;
    } else {
      _state = ShortsFeedState.loadingNextPage;
    }
    notifyListeners();

    try {
      final cursorParam = isRefresh ? '' : (_nextCursor ?? '');
      final response = await http.get(
        Uri.parse('https://trasx.com/api/feed/reels?cursor=$cursorParam&limit=8'),
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '$currentUserId',
        },
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['reels'] != null) {
          final List<dynamic> newReels = data['reels'];

          if (isRefresh) {
            _reels.clear();
          }

          // Élimination des doublons
          final existingIds = _reels.map((r) => int.tryParse(r['id']?.toString() ?? '')).toSet();
          for (var reel in newReels) {
            final id = int.tryParse(reel['id']?.toString() ?? '');
            if (id != null && !existingIds.contains(id)) {
              _reels.add(reel);
            }
          }

          _hasMore = data['hasMore'] ?? false;
          _nextCursor = data['nextCursor']?.toString();

          if (_reels.isEmpty) {
            _state = ShortsFeedState.empty;
          } else if (!_hasMore) {
            _state = ShortsFeedState.ended;
          } else {
            _state = ShortsFeedState.success;
          }
          NetworkQualityService().recordSuccess();
        } else {
          _state = isRefresh && _reels.isEmpty ? ShortsFeedState.empty : ShortsFeedState.success;
        }
      } else {
        _state = _reels.isEmpty ? ShortsFeedState.networkError : ShortsFeedState.success;
        NetworkQualityService().recordError();
      }
    } catch (e) {
      debugPrint('Error fetching reels: $e');
      _state = _reels.isEmpty ? ShortsFeedState.networkError : ShortsFeedState.success;
      final errStr = e.toString().toLowerCase();
      if (errStr.contains('socketexception') || errStr.contains('handshake') || errStr.contains('failed host lookup') || errStr.contains('timeout')) {
        NetworkQualityService().recordOffline();
      } else {
        NetworkQualityService().recordError();
      }
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void updateReelLikes(int reelId, int likesCount) {
    final index = _reels.indexWhere((r) => int.tryParse(r['id']?.toString() ?? '') == reelId);
    if (index != -1) {
      _reels[index]['likes_count'] = likesCount;
      notifyListeners();
    }
  }

  void updateReelComments(int reelId, int commentsCount) {
    final index = _reels.indexWhere((r) => int.tryParse(r['id']?.toString() ?? '') == reelId);
    if (index != -1) {
      _reels[index]['comments_count'] = commentsCount;
      notifyListeners();
    }
  }

  void updateReelShares(int reelId, int sharesCount) {
    final index = _reels.indexWhere((r) => int.tryParse(r['id']?.toString() ?? '') == reelId);
    if (index != -1) {
      _reels[index]['shares_count'] = sharesCount;
      notifyListeners();
    }
  }

  void toggleReelLikeLocal(int index, bool isLiked) {
    if (index < 0 || index >= _reels.length) return;
    final reel = _reels[index];
    final currentLikes = int.tryParse(reel['likes_count']?.toString() ?? '0') ?? 0;
    reel['likes_count'] = isLiked ? currentLikes + 1 : currentLikes - 1;
    notifyListeners();
  }
}
