// lib/services/feed_cache_service.dart
// Cache local du fil avec SharedPreferences (stale-while-revalidate)

import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/post_model.dart';

class FeedCacheService {
  static const String _kPosts = 'feed_cache_posts_v2';
  static const String _kTimestamp = 'feed_cache_timestamp_v2';
  static const String _kCursor = 'feed_cache_cursor_v2';
  static const Duration _maxAge = Duration(minutes: 15);
  static const int _maxCachedPosts = 30;

  /// Lit les posts du cache. Retourne null si le cache est vide.
  static Future<List<Post>?> readPosts() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kPosts);
      if (raw == null || raw.isEmpty) return null;
      final List<dynamic> decoded = jsonDecode(raw) as List<dynamic>;
      return decoded
          .map((e) => Post.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return null;
    }
  }

  /// Lit le curseur stocké pour la pagination.
  static Future<String?> readCursor() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_kCursor);
    } catch (_) {
      return null;
    }
  }

  /// Sauvegarde les posts (limité à [_maxCachedPosts]).
  static Future<void> writePosts(List<Post> posts, {String? nextCursor}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final limited = posts.take(_maxCachedPosts).toList();
      final encoded = jsonEncode(limited.map((p) => p.toJson()).toList());
      await prefs.setString(_kPosts, encoded);
      await prefs.setInt(_kTimestamp, DateTime.now().millisecondsSinceEpoch);
      if (nextCursor != null) {
        await prefs.setString(_kCursor, nextCursor);
      }
    } catch (_) {}
  }

  /// Retourne true si le cache est encore frais.
  static Future<bool> isFresh() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final ts = prefs.getInt(_kTimestamp);
      if (ts == null) return false;
      final age = DateTime.now().millisecondsSinceEpoch - ts;
      return age < _maxAge.inMilliseconds;
    } catch (_) {
      return false;
    }
  }

  /// Invalide le cache.
  static Future<void> invalidate() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kPosts);
      await prefs.remove(_kTimestamp);
      await prefs.remove(_kCursor);
    } catch (_) {}
  }

  /// Met à jour un seul post dans le cache (like/bookmark optimiste).
  static Future<void> updatePost(Post updated) async {
    try {
      final posts = await readPosts();
      if (posts == null) return;
      final idx = posts.indexWhere((p) => p.id == updated.id);
      if (idx == -1) return;
      posts[idx] = updated;
      await writePosts(posts);
    } catch (_) {}
  }
}
