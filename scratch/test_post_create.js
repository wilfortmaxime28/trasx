const db = require('../config/db');
const Post = require('../models/Post');

async function test() {
  try {
    const config = {
      type: 'vote',
      title: 'Test Vote Challenge',
      entryMode: 'invite_only',
      voteMode: 'free',
      votePrice: 0,
      invitedUserId: null,
      creatorSharePercent: 20,
      participantSharePercent: 80
    };

    console.log('Testing Post.create...');
    const postId = await Post.create(
      2, // user_id
      'Test challenge post content',
      null, null, null, null, null, null, null, // styling
      0, null, null, // trade
      null, null, 1, // media & download
      null, null, null, // extra images
      0, 0, 0, // promo
      config
    );
    console.log('Post created successfully! ID:', postId);
  } catch (error) {
    console.error('Post.create failed with error:', error);
  } finally {
    process.exit(0);
  }
}

test();
