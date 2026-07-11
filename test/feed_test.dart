import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:trasx/models/post_model.dart';
import 'package:trasx/services/feed_cache_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Post Model & Deduplication Tests', () {
    test('Post.fromJson parsing with various null and numeric configurations', () {
      final json = {
        'id': '101',
        'author_id': 55,
        'author_username': 'johndoe',
        'content': 'Hello world',
        'is_trade': 1,
        'likes_count': '42',
        'comments_count': 12,
        'is_liked': 'true',
        'is_bookmarked': 0,
      };

      final post = Post.fromJson(json);

      expect(post.id, 101);
      expect(post.authorId, 55);
      expect(post.authorUsername, 'johndoe');
      expect(post.authorDisplayName, 'johndoe'); // fallback
      expect(post.isTrade, true);
      expect(post.likesCount, 42);
      expect(post.commentsCount, 12);
      expect(post.isLiked, true);
      expect(post.isBookmarked, false);
    });

    test('Post.merge avoids duplicates and preserves ordering (newest first)', () {
      final existing = [
        const Post(id: 1, authorId: 1, authorUsername: 'a', authorDisplayName: 'a', content: 'c1', isTrade: false, likesCount: 10, commentsCount: 5, sharesCount: 0, isLiked: false, isBookmarked: false, isAuthorFollowing: false),
        const Post(id: 2, authorId: 2, authorUsername: 'b', authorDisplayName: 'b', content: 'c2', isTrade: false, likesCount: 20, commentsCount: 6, sharesCount: 0, isLiked: false, isBookmarked: false, isAuthorFollowing: false),
      ];

      final incoming = [
        const Post(id: 3, authorId: 3, authorUsername: 'c', authorDisplayName: 'c', content: 'c3', isTrade: false, likesCount: 30, commentsCount: 7, sharesCount: 0, isLiked: false, isBookmarked: false, isAuthorFollowing: false),
        // updated version of post 2
        const Post(id: 2, authorId: 2, authorUsername: 'b', authorDisplayName: 'b', content: 'c2-updated', isTrade: false, likesCount: 25, commentsCount: 6, sharesCount: 0, isLiked: true, isBookmarked: false, isAuthorFollowing: false),
      ];

      final merged = Post.merge(existing, incoming);

      // Order should be incoming first, then older ones
      expect(merged.length, 3);
      expect(merged[0].id, 3);
      expect(merged[1].id, 2);
      expect(merged[1].isLiked, true); // updated value wins
      expect(merged[1].content, 'c2-updated');
      expect(merged[2].id, 1);
    });

    test('Post.appendPage adds paginated posts without duplicating existing ones', () {
      final existing = [
        const Post(id: 1, authorId: 1, authorUsername: 'a', authorDisplayName: 'a', content: 'c1', isTrade: false, likesCount: 10, commentsCount: 5, sharesCount: 0, isLiked: false, isBookmarked: false, isAuthorFollowing: false),
      ];
      final newPage = [
        const Post(id: 1, authorId: 1, authorUsername: 'a', authorDisplayName: 'a', content: 'c1', isTrade: false, likesCount: 10, commentsCount: 5, sharesCount: 0, isLiked: false, isBookmarked: false, isAuthorFollowing: false),
        const Post(id: 2, authorId: 2, authorUsername: 'b', authorDisplayName: 'b', content: 'c2', isTrade: false, likesCount: 20, commentsCount: 6, sharesCount: 0, isLiked: false, isBookmarked: false, isAuthorFollowing: false),
      ];

      final appended = Post.appendPage(existing, newPage);
      expect(appended.length, 2);
      expect(appended[0].id, 1);
      expect(appended[1].id, 2);
    });
  });

  group('Feed Cache Service Tests', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('FeedCacheService read/write and updates', () async {
      final posts = [
        const Post(id: 1, authorId: 1, authorUsername: 'a', authorDisplayName: 'a', content: 'c1', isTrade: false, likesCount: 10, commentsCount: 5, sharesCount: 0, isLiked: false, isBookmarked: false, isAuthorFollowing: false),
      ];

      await FeedCacheService.writePosts(posts, nextCursor: 'cursor_token');
      
      final cached = await FeedCacheService.readPosts();
      final cursor = await FeedCacheService.readCursor();

      expect(cached, isNotNull);
      expect(cached!.length, 1);
      expect(cached[0].id, 1);
      expect(cursor, 'cursor_token');

      // Update post in cache
      final updated = cached[0].copyWith(isLiked: true, likesCount: 11);
      await FeedCacheService.updatePost(updated);

      final cachedAfterUpdate = await FeedCacheService.readPosts();
      expect(cachedAfterUpdate![0].isLiked, true);
      expect(cachedAfterUpdate[0].likesCount, 11);
    });
  });
}
