const db = require('../config/db');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Hashtag = require('../models/Hashtag');
const Notification = require('../models/Notification');

async function runTests() {
  console.log('=== STARTING HASHTAGS AND MENTIONS INTEGRATION TESTS ===');

  let testUser1Id = null;
  let testUser2Id = null;
  let postId = null;

  try {
    // Clean up any stale test users
    await db.query("DELETE FROM users WHERE username IN ('testuser1', 'testuser2')");
    await db.query("DELETE FROM hashtags WHERE name IN ('testtag1', 'testtag2')");

    // 1. Create two test users
    const [res1] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['testuser1', 'testuser1@example.com', 'hash', 'Jean', 'Dupont', '2000-01-01', '123456789', 'France', 'None', 'Active']
    );
    testUser1Id = res1.insertId;

    const [res2] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, certification_type, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['testuser2', 'testuser2@example.com', 'hash', 'Marie', 'Curie', '2000-01-01', '123456789', 'France', 'None', 'Active']
    );
    testUser2Id = res2.insertId;

    console.log(`Created test users: User1 (ID ${testUser1Id}), User2 (ID ${testUser2Id})`);

    // 2. Simulate socket.on('create-post') logic
    console.log('\n--- Simulating Post Creation with #testtag1 and @testuser2 ---');
    const content = "Hello world! This is my first post with #testtag1 and mentioning @testuser2.";

    postId = await Post.create(
      testUser1Id,
      content,
      null, null, null, null, null, null, null, 0, null, null, 'text'
    );
    console.log(`Created post with ID: ${postId}`);

    // Parse hashtags
    const hashtags = [];
    const tagRegex = /(?:^|[^a-zA-Z0-9_])#([a-zA-Z0-9_]+)/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      hashtags.push(tagMatch[1].toLowerCase());
    }
    const uniqueHashtags = [...new Set(hashtags)];
    for (const tagName of uniqueHashtags) {
      const existing = await Hashtag.getByName(tagName);
      if (!existing) {
        await Hashtag.create(tagName, testUser1Id, 0, 0.00);
        console.log(`Successfully created hashtag: #${tagName}`);
      }
    }

    // Parse mentions
    const mentions = [];
    const mentionRegex = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g;
    let mMatch;
    while ((mMatch = mentionRegex.exec(content)) !== null) {
      mentions.push(mMatch[1].toLowerCase());
    }
    const uniqueMentions = [...new Set(mentions)];
    for (const username of uniqueMentions) {
      const targetUser = await User.getByUsername(username);
      if (targetUser && Number(targetUser.id) !== Number(testUser1Id)) {
        const actorUser = await User.getById(testUser1Id);
        const actorName = actorUser ? `${actorUser.first_name} ${actorUser.last_name}` : 'WeShare';
        const messageText = `${actorName} vous a mentionné dans une publication.`;
        
        await Notification.create({
          recipientId: targetUser.id,
          actorId: testUser1Id,
          type: 'mention',
          message: messageText,
          postId: postId
        });
        console.log(`Successfully sent mention notification to @${username}`);
      }
    }

    // 3. Verify Hashtag was created in DB
    const createdHashtag = await Hashtag.getByName('testtag1');
    if (createdHashtag) {
      console.log('>> SUCCESS: Hashtag testtag1 exists in DB!');
    } else {
      throw new Error('Hashtag testtag1 was not found in DB.');
    }

    // 4. Verify details retrieval and usage count
    const hashtagDetails = await Hashtag.getDetailsByName('testtag1');
    if (hashtagDetails) {
      console.log('>> SUCCESS: Retrieved hashtag details:');
      console.log(`- Creator Username: ${hashtagDetails.username} (ID: ${hashtagDetails.creator_id})`);
      console.log(`- Creator Avatar: ${hashtagDetails.avatar}`);
      console.log(`- Usage count: ${hashtagDetails.usage_count}`);
      if (Number(hashtagDetails.usage_count) === 1) {
        console.log('>> SUCCESS: Usage count is correctly tracked as 1!');
      } else {
        throw new Error(`Usage count is incorrect: ${hashtagDetails.usage_count}`);
      }
    } else {
      throw new Error('Could not retrieve hashtag details.');
    }

    // 5. Verify Notification was created in DB
    const notifications = await Notification.getRecentForUser(testUser2Id, 5);
    const mentionNotif = notifications.find(n => n.type === 'mention' && n.post_id === postId);
    if (mentionNotif) {
      console.log('>> SUCCESS: Mention notification was successfully stored in DB!');
      console.log(`- Message: ${mentionNotif.message}`);
      console.log(`- Actor Name: ${mentionNotif.actor_name}`);
      console.log(`- Actor Avatar: ${mentionNotif.actor_avatar}`);
    } else {
      throw new Error('Mention notification not found for testuser2.');
    }

    // 6. Simulate Comment Creation with Mention
    console.log('\n--- Simulating Comment Creation with mention @testuser2 ---');
    const commentContent = "Hey @testuser2, check this comment out!";
    const commentId = await Comment.create(postId, testUser1Id, commentContent);

    // Send real-time notifications for mentions in comment
    const commentMentions = [];
    let cmMatch;
    while ((cmMatch = mentionRegex.exec(commentContent)) !== null) {
      commentMentions.push(cmMatch[1].toLowerCase());
    }
    const uniqueCommentMentions = [...new Set(commentMentions)];
    for (const username of uniqueCommentMentions) {
      const targetUser = await User.getByUsername(username);
      if (targetUser && Number(targetUser.id) !== Number(testUser1Id)) {
        const actorUser = await User.getById(testUser1Id);
        const actorName = actorUser ? `${actorUser.first_name} ${actorUser.last_name}` : 'WeShare';
        const messageText = `${actorName} vous a mentionné dans un commentaire.`;
        
        await Notification.create({
          recipientId: targetUser.id,
          actorId: testUser1Id,
          type: 'mention',
          message: messageText,
          postId: postId,
          commentId: commentId
        });
        console.log(`Successfully sent comment mention notification to @${username}`);
      }
    }

    // 7. Verify Comment Notification
    const commentNotifications = await Notification.getRecentForUser(testUser2Id, 5);
    const commentMentionNotif = commentNotifications.find(n => n.type === 'mention' && n.comment_id === commentId);
    if (commentMentionNotif) {
      console.log('>> SUCCESS: Comment mention notification was successfully stored in DB!');
      console.log(`- Message: ${commentMentionNotif.message}`);
    } else {
      throw new Error('Comment mention notification not found for testuser2.');
    }

    console.log('\n=== ALL HASHTAGS AND MENTIONS TESTS PASSED SUCCESSFULLY ===');

  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  } finally {
    console.log('\nCleaning up test records...');
    if (postId) {
      await db.query('DELETE FROM comments WHERE post_id = ?', [postId]);
      await db.query('DELETE FROM notifications WHERE post_id = ?', [postId]);
      await db.query('DELETE FROM posts WHERE id = ?', [postId]);
    }
    if (testUser1Id) {
      await db.query('DELETE FROM users WHERE id IN (?, ?)', [testUser1Id, testUser2Id]);
    }
    await db.query("DELETE FROM hashtags WHERE name IN ('testtag1', 'testtag2')");
    db.end();
  }
}

runTests();
