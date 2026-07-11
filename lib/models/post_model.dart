// lib/models/post_model.dart — Modèle Post typé et immuable pour TrasX

class Post {
  final int id;
  final int authorId;
  final String authorUsername;
  final String authorDisplayName;
  final String? authorAvatar;
  final String content;
  final String? imageUrl;
  final String? thumbnailUrl;
  final bool isTrade;
  final int likesCount;
  final int commentsCount;
  final int sharesCount;
  final bool isLiked;
  final bool isBookmarked;
  final bool isAuthorFollowing;
  final String? createdAt;

  const Post({
    required this.id,
    required this.authorId,
    required this.authorUsername,
    required this.authorDisplayName,
    this.authorAvatar,
    required this.content,
    this.imageUrl,
    this.thumbnailUrl,
    required this.isTrade,
    required this.likesCount,
    required this.commentsCount,
    required this.sharesCount,
    required this.isLiked,
    required this.isBookmarked,
    required this.isAuthorFollowing,
    this.createdAt,
  });

  static bool _parseBool(dynamic v) =>
      v == true || v == 1 || v == '1' || v == 'true';

  static int _parseInt(dynamic v) {
    if (v == null) return 0;
    if (v is int) return v;
    if (v is double) return v.toInt();
    return int.tryParse(v.toString()) ?? 0;
  }

  static String _str(dynamic v) => v?.toString() ?? '';

  factory Post.fromJson(Map<String, dynamic> json) => Post(
        id: _parseInt(json['id']),
        authorId: _parseInt(json['author_id'] ?? json['user_id']),
        authorUsername: _str(json['author_username'] ?? json['username']),
        authorDisplayName: _str(
          json['author_display_name'] ?? json['display_name'] ??
          json['author_username'] ?? json['username'],
        ),
        authorAvatar: json['author_avatar'] as String?,
        content: _str(json['content']),
        imageUrl: json['image_url'] as String?,
        thumbnailUrl: json['thumbnail_url'] as String?,
        isTrade: _parseBool(json['is_trade']),
        likesCount: _parseInt(json['likes_count']),
        commentsCount: _parseInt(json['comments_count']),
        sharesCount: _parseInt(json['shares_count']),
        isLiked: _parseBool(json['is_liked']),
        isBookmarked: _parseBool(json['is_bookmarked']),
        isAuthorFollowing: _parseBool(
          json['is_author_following'] ?? json['is_following'],
        ),
        createdAt: json['created_at'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'author_id': authorId,
        'author_username': authorUsername,
        'author_display_name': authorDisplayName,
        'author_avatar': authorAvatar,
        'content': content,
        'image_url': imageUrl,
        'thumbnail_url': thumbnailUrl,
        'is_trade': isTrade ? 1 : 0,
        'likes_count': likesCount,
        'comments_count': commentsCount,
        'shares_count': sharesCount,
        'is_liked': isLiked ? 1 : 0,
        'is_bookmarked': isBookmarked ? 1 : 0,
        'is_author_following': isAuthorFollowing ? 1 : 0,
        'created_at': createdAt,
      };

  Post copyWith({
    int? id,
    int? authorId,
    String? authorUsername,
    String? authorDisplayName,
    String? authorAvatar,
    String? content,
    String? imageUrl,
    String? thumbnailUrl,
    bool? isTrade,
    int? likesCount,
    int? commentsCount,
    int? sharesCount,
    bool? isLiked,
    bool? isBookmarked,
    bool? isAuthorFollowing,
    String? createdAt,
  }) =>
      Post(
        id: id ?? this.id,
        authorId: authorId ?? this.authorId,
        authorUsername: authorUsername ?? this.authorUsername,
        authorDisplayName: authorDisplayName ?? this.authorDisplayName,
        authorAvatar: authorAvatar ?? this.authorAvatar,
        content: content ?? this.content,
        imageUrl: imageUrl ?? this.imageUrl,
        thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
        isTrade: isTrade ?? this.isTrade,
        likesCount: likesCount ?? this.likesCount,
        commentsCount: commentsCount ?? this.commentsCount,
        sharesCount: sharesCount ?? this.sharesCount,
        isLiked: isLiked ?? this.isLiked,
        isBookmarked: isBookmarked ?? this.isBookmarked,
        isAuthorFollowing: isAuthorFollowing ?? this.isAuthorFollowing,
        createdAt: createdAt ?? this.createdAt,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Post &&
          other.id == id &&
          other.likesCount == likesCount &&
          other.commentsCount == commentsCount &&
          other.isLiked == isLiked &&
          other.isBookmarked == isBookmarked &&
          other.isAuthorFollowing == isAuthorFollowing;

  @override
  int get hashCode => id.hashCode;

  /// Refresh merge (pull-to-refresh) : incoming en tête, anciens conservés.
  static List<Post> merge(List<Post> existing, List<Post> incoming) {
    final map = <int, Post>{};
    for (final p in existing) map[p.id] = p;
    for (final p in incoming) map[p.id] = p;
    final incomingIds = incoming.map((p) => p.id).toSet();
    return [
      ...incoming,
      ...existing.where((p) => !incomingIds.contains(p.id)),
    ];
  }

  /// Pagination : ajoute en bas sans doublons.
  static List<Post> appendPage(List<Post> existing, List<Post> newPage) {
    final existingIds = existing.map((p) => p.id).toSet();
    return [
      ...existing,
      ...newPage.where((p) => !existingIds.contains(p.id)),
    ];
  }
}
