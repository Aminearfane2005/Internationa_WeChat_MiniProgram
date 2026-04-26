const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const safeString = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const now = () => new Date();

function monthKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = `${dateObj.getMonth() + 1}`.padStart(2, '0');
  return `${y}-${m}`;
}

function getMonthRange(dateObj) {
  const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

async function getUserProfile(openid) {
  const userRes = await db.collection('users').where({ openId: openid }).limit(1).get();
  const user = userRes.data[0] || {};
  return {
    uid: openid,
    name: user.nickName || 'User',
    avatar: user.avatarUrl || 'https://via.placeholder.com/120x120.png?text=U'
  };
}

async function getFeed(event, openid) {
  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(20, Math.max(1, Number(event.limit) || 10));
  const activeLeaders = await getOrCreateMonthlyLeaders();
  const postRes = await db.collection('posts')
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get();

  const data = postRes.data.map((p) => {
    const likeUsers = Array.isArray(p.likeUsers) ? p.likeUsers : [];
    const comments = Array.isArray(p.comments) ? p.comments : [];
    const authorUid = p.author && p.author.uid ? p.author.uid : '';
    return {
      ...p,
      likeUsers,
      comments,
      likeCount: typeof p.likeCount === 'number' ? p.likeCount : likeUsers.length,
      commentCount: typeof p.commentCount === 'number' ? p.commentCount : comments.length,
      hasLiked: likeUsers.includes(openid),
      badges: {
        topPoster: Boolean(activeLeaders.topPoster && authorUid === activeLeaders.topPoster.uid),
        topLiker: Boolean(activeLeaders.topLiker && authorUid === activeLeaders.topLiker.uid)
      }
    };
  });
  return { success: true, data, leaders: activeLeaders };
}

async function publishPost(event, openid) {
  const content = safeString(event.content, 1200);
  const images = Array.isArray(event.images) ? event.images.slice(0, 9) : [];
  if (!content && images.length === 0) {
    return { success: false, message: 'Empty post' };
  }
  const profile = await getUserProfile(openid);
  const payload = {
    author: profile,
    content,
    images,
    likeUsers: [],
    likeCount: 0,
    commentCount: 0,
    comments: [],
    createdAt: db.serverDate()
  };
  const res = await db.collection('posts').add({ data: payload });
  return { success: true, postId: res._id };
}

async function toggleLike(event, openid) {
  const postId = safeString(event.postId, 80);
  if (!postId) return { success: false, message: 'Invalid post id' };
  const doc = await db.collection('posts').doc(postId).get();
  const post = doc.data || {};
  const likes = Array.isArray(post.likeUsers) ? post.likeUsers : [];
  const hasLiked = likes.includes(openid);
  await db.collection('posts').doc(postId).update({
    data: {
      likeUsers: hasLiked ? _.pull(openid) : _.addToSet(openid),
      likeCount: _.inc(hasLiked ? -1 : 1)
    }
  });
  return { success: true, liked: !hasLiked };
}

function withCommentLikeMeta(comment) {
  return {
    ...comment,
    likeUsers: Array.isArray(comment.likeUsers) ? comment.likeUsers : [],
    likeCount: typeof comment.likeCount === 'number' ? comment.likeCount : 0,
    replies: Array.isArray(comment.replies) ? comment.replies : []
  };
}

async function addComment(event, openid) {
  const postId = safeString(event.postId, 80);
  const parentId = safeString(event.parentCommentId, 80);
  const text = safeString(event.text, 500);
  if (!postId || !text) return { success: false, message: 'Invalid payload' };

  const profile = await getUserProfile(openid);
  const postDoc = await db.collection('posts').doc(postId).get();
  const post = postDoc.data || {};
  const comments = Array.isArray(post.comments) ? post.comments.map(withCommentLikeMeta) : [];
  const commentObj = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    authorId: openid,
    authorName: profile.name,
    text,
    createdAt: now(),
    likeUsers: [],
    likeCount: 0,
    replies: []
  };

  if (!parentId) {
    comments.push(commentObj);
  } else {
    const idx = comments.findIndex((c) => c.id === parentId);
    if (idx < 0) return { success: false, message: 'Parent comment not found' };
    comments[idx].replies.push(commentObj);
  }

  await db.collection('posts').doc(postId).update({
    data: {
      comments,
      commentCount: _.inc(1)
    }
  });
  return { success: true };
}

async function toggleCommentLike(event, openid) {
  const postId = safeString(event.postId, 80);
  const commentId = safeString(event.commentId, 80);
  const parentId = safeString(event.parentCommentId, 80);
  if (!postId || !commentId) return { success: false, message: 'Invalid payload' };

  const postDoc = await db.collection('posts').doc(postId).get();
  const post = postDoc.data || {};
  const comments = Array.isArray(post.comments) ? post.comments.map(withCommentLikeMeta) : [];
  let changed = false;

  const toggle = (item) => {
    const users = Array.isArray(item.likeUsers) ? item.likeUsers : [];
    const has = users.includes(openid);
    item.likeUsers = has ? users.filter((u) => u !== openid) : users.concat(openid);
    item.likeCount = Math.max(0, Number(item.likeCount || 0) + (has ? -1 : 1));
  };

  comments.forEach((c) => {
    if (!parentId && c.id === commentId) {
      toggle(c);
      changed = true;
      return;
    }
    c.replies = Array.isArray(c.replies) ? c.replies : [];
    c.replies.forEach((r) => {
      if (parentId && c.id === parentId && r.id === commentId) {
        toggle(r);
        changed = true;
      }
    });
  });

  if (!changed) return { success: false, message: 'Comment not found' };
  await db.collection('posts').doc(postId).update({ data: { comments } });
  return { success: true };
}

async function createStory(event, openid) {
  const mediaUrl = safeString(event.mediaUrl, 1000);
  const type = safeString(event.type || 'image', 10);
  if (!mediaUrl) return { success: false, message: 'mediaUrl required' };
  const profile = await getUserProfile(openid);
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  const res = await db.collection('stories').add({
    data: {
      author: profile,
      mediaUrl,
      type,
      viewers: [],
      createdAt,
      expiresAt
    }
  });
  return { success: true, storyId: res._id };
}

async function getStories(event, openid) {
  const ts = now();
  const res = await db.collection('stories')
    .where({ expiresAt: _.gt(ts) })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const grouped = {};
  res.data.forEach((s) => {
    const uid = (s.author && s.author.uid) || 'unknown';
    if (!grouped[uid]) {
      grouped[uid] = {
        author: s.author || {},
        hasUnseen: false,
        items: []
      };
    }
    const viewed = Array.isArray(s.viewers) && s.viewers.includes(openid);
    if (!viewed) grouped[uid].hasUnseen = true;
    grouped[uid].items.push({
      _id: s._id,
      mediaUrl: s.mediaUrl,
      type: s.type || 'image',
      createdAt: s.createdAt,
      viewed
    });
  });

  return { success: true, data: Object.values(grouped) };
}

async function viewStory(event, openid) {
  const storyId = safeString(event.storyId, 80);
  if (!storyId) return { success: false, message: 'Invalid story id' };
  await db.collection('stories').doc(storyId).update({
    data: { viewers: _.addToSet(openid) }
  });
  return { success: true };
}

async function getOrCreateMonthlyLeaders() {
  const today = now();
  const currentKey = monthKey(today);
  const existing = await db.collection('monthlyLeaders').where({ monthKey: currentKey }).limit(1).get();
  if (existing.data.length) return existing.data[0];

  const { start, end } = getMonthRange(today);
  const postsRes = await db.collection('posts')
    .where({ createdAt: _.gte(start).and(_.lt(end)) })
    .limit(1000)
    .get();
  const posts = postsRes.data || [];

  const postCountByUser = {};
  const likesGivenByUser = {};

  posts.forEach((p) => {
    const uid = p.author && p.author.uid ? p.author.uid : '';
    if (uid) postCountByUser[uid] = (postCountByUser[uid] || 0) + 1;
    const likeUsers = Array.isArray(p.likeUsers) ? p.likeUsers : [];
    likeUsers.forEach((lid) => {
      likesGivenByUser[lid] = (likesGivenByUser[lid] || 0) + 1;
    });
  });

  const topPosterId = Object.keys(postCountByUser).sort((a, b) => postCountByUser[b] - postCountByUser[a])[0] || '';
  const topLikerId = Object.keys(likesGivenByUser).sort((a, b) => likesGivenByUser[b] - likesGivenByUser[a])[0] || '';

  const makeLeader = async (uid, score) => {
    if (!uid) return null;
    const profile = await getUserProfile(uid);
    return { uid, name: profile.name, avatar: profile.avatar, score };
  };

  const topPoster = await makeLeader(topPosterId, postCountByUser[topPosterId] || 0);
  const topLiker = await makeLeader(topLikerId, likesGivenByUser[topLikerId] || 0);

  const doc = {
    monthKey: currentKey,
    topPoster,
    topLiker,
    createdAt: db.serverDate()
  };
  await db.collection('monthlyLeaders').add({ data: doc });
  return doc;
}

exports.main = async (event = {}, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const action = safeString(event.action, 40);
  try {
    switch (action) {
      case 'getFeed':
        return await getFeed(event, openid);
      case 'publishPost':
        return await publishPost(event, openid);
      case 'toggleLike':
        return await toggleLike(event, openid);
      case 'addComment':
        return await addComment(event, openid);
      case 'toggleCommentLike':
        return await toggleCommentLike(event, openid);
      case 'createStory':
        return await createStory(event, openid);
      case 'getStories':
        return await getStories(event, openid);
      case 'viewStory':
        return await viewStory(event, openid);
      case 'getMonthlyLeaders':
        return { success: true, data: await getOrCreateMonthlyLeaders() };
      default:
        return { success: false, message: 'Unsupported action' };
    }
  } catch (err) {
    console.error('communityOps error', action, err);
    return { success: false, message: err && err.message ? err.message : 'Server error' };
  }

  
};
