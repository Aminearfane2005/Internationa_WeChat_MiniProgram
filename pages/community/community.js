const PAGE_SIZE = 10;
const FALLBACK_AVATAR = 'https://api.dicebear.com/9.x/adventurer/svg?seed=user';
const db = wx.cloud.database();
const _ = db.command;

function formatRelative(timeVal) {
  if (!timeVal) return 'now';
  const d = new Date(timeVal);
  if (Number.isNaN(d.getTime())) return 'now';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

Page({
  data: {
    statusBarHeight: 20,
    posts: [],
    draftText: '',
    tempImages: [],
    isRefreshing: false,
    isLoadingMore: false,
    hasMore: true,
    isPublishing: false,
    userInfo: {
      nickName: 'Guest',
      avatarUrl: FALLBACK_AVATAR
    },
    showCommentModal: false,
    modalText: '',
    replyTargetPostId: '',
    replyParentCommentId: '',
    replyTargetName: '',
    modalFocus: false
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 });
    this.loadUser();
    this.fetchFeed(false);
  },
  
  onShow() {
    this.loadUser();
  },

  loadUser() {
    const cache = wx.getStorageSync('user') || {};
    this.setData({
      userInfo: {
        nickName: cache.username || cache.nickName || 'Guest',
        avatarUrl: cache.avatar || cache.avatarUrl || FALLBACK_AVATAR
      }
    });
  },

  // 3. MAIN FEED FETCHING (Fixes [object Object] Date Bug)
  async fetchFeed(isAppend = false) {
    if (this.data.isLoadingMore && isAppend) return;
    
    isAppend ? this.setData({ isLoadingMore: true }) : wx.showNavigationBarLoading();
    const skipCount = isAppend ? this.data.posts.length : 0;

    try {
      const res = await db.collection('posts')
        .orderBy('createdAt', 'desc')
        .skip(skipCount)
        .limit(10)
        .get();

      const processedPosts = res.data.map(post => {
        // FIX: Convert Date Object to String before sending to WXML
        let displayTime = 'Just now';
        if (post.createdAt instanceof Date) {
          const d = post.createdAt;
          const month = d.getMonth() + 1;
          const date = d.getDate();
          const hours = d.getHours().toString().padStart(2, '0');
          const mins = d.getMinutes().toString().padStart(2, '0');
          displayTime = `${month}/${date} ${hours}:${mins}`;
        }
        return { ...post, dateDisplay: displayTime };
      });

      this.setData({
        posts: isAppend ? [...this.data.posts, ...processedPosts] : processedPosts,
        isRefreshing: false,
        isLoadingMore: false
      });
      
    } catch (err) {
      console.error("Feed Error:", err);
      wx.showToast({ title: 'Offline Mode', icon: 'none' });
    } finally {
      wx.hideNavigationBarLoading();
      wx.stopPullDownRefresh();
    }
  },

  // 4. PUBLISHING ENGINE
  onInputSync(e) { this.setData({ draftText: e.detail.value }); },

  onChooseImage() {
    wx.chooseImage({
      count: 9,
      sizeType: ['compressed'],
      success: (res) => {
        this.setData({ tempImages: [...this.data.tempImages, ...res.tempFilePaths] });
      }
    });
  },

  removeTempImg(e) {
    const { index } = e.currentTarget.dataset;
    const tempImages = this.data.tempImages;
    tempImages.splice(index, 1);
    this.setData({ tempImages });
  },

  async publishPost() {
    const { draftText, tempImages, userInfo } = this.data;
    if (!draftText.trim() && tempImages.length === 0) return;

    wx.showLoading({ title: 'Uploading...', mask: true });

    try {
      const fileIDs = [];
      for (const [i, path] of tempImages.entries()) {
        const cloudRes = await wx.cloud.uploadFile({
          cloudPath: `community/${Date.now()}-${i}.png`,
          filePath: path
        });
        fileIDs.push(cloudRes.fileID);
      }

      const newPost = {
        author: {
          name: userInfo.nickName,
          avatar: userInfo.avatarUrl,
          isMonthlyWinner: false, // Will be updated by Cloud Function later
          isOnline: true
        },
        content: draftText,
        images: fileIDs,
        likeCount: 0,
        commentCount: 0,
        hasLiked: false,
        comments: [],
        createdAt: db.serverDate() // Server generates this
      };

      await db.collection('posts').add({ data: newPost });

      this.setData({ draftText: '', tempImages: [] });
      wx.showToast({ title: 'Shared!' });
      this.fetchFeed(); // Refresh to show new post
      
    } catch (err) {
      wx.showToast({ title: 'Failed to post', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 5. INTERACTION (LIKES)
  async toggleLike(e) {
    const { index } = e.currentTarget.dataset;
    const post = this.data.posts[index];
    if (!post._id) return;

    const isLiking = !post.hasLiked;
    const increment = isLiking ? 1 : -1;
    const postKey = `posts[${index}]`;

    // Optimistic UI Update
    this.setData({
      [`${postKey}.hasLiked`]: isLiking,
      [`${postKey}.likeCount`]: post.likeCount + increment
    });

    if (isLiking) wx.vibrateShort({ type: 'light' });

    try {
      await db.collection('posts').doc(post._id).update({
        data: { likeCount: _.inc(increment) }
      });
    } catch (err) {
      // Revert if DB fails
      this.setData({
        [`${postKey}.hasLiked`]: post.hasLiked,
        [`${postKey}.likeCount`]: post.likeCount
      });
    }
  },

  // 6. COMMENT SYSTEM
  initiateReply(e) {
    const { postid, commentid, name } = e.currentTarget.dataset;
    this.setData({
      showCommentModal: true,
      replyTargetPostId: postid,
      replyTargetCommentId: commentid || null,
      replyTargetName: name,
      modalFocus: true
    });
  },

  onModalInput(e) { this.setData({ modalText: e.detail.value }); },

  async submitModalComment() {
    const { modalText, replyTargetPostId, replyTargetCommentId, userInfo } = this.data;
    if (!modalText.trim()) return;

    wx.showLoading({ title: 'Sending...' });

    try {
      const postRef = db.collection('posts').doc(replyTargetPostId);
      
      if (replyTargetCommentId) {
        // NESTED REPLY
        const postData = (await postRef.get()).data;
        const updatedComments = postData.comments.map(c => {
          if (c.id === replyTargetCommentId) {
            c.replies = c.replies || [];
            c.replies.push({
              id: Date.now().toString(),
              authorName: userInfo.nickName,
              text: modalText
            });
          }
          return c;
        });
        await postRef.update({ data: { comments: updatedComments, commentCount: _.inc(1) } });
      } else {
        // TOP LEVEL COMMENT
        const newComment = {
          id: Date.now().toString(),
          authorName: userInfo.nickName,
          text: modalText,
          replies: []
        };
        await postRef.update({
          data: { 
            comments: _.push(newComment), 
            commentCount: _.inc(1) 
          }
        });
      }

      this.setData({ showCommentModal: false, modalText: '' });
      this.fetchFeed(); 
    } catch (err) {
      wx.showToast({ title: 'Reply failed', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  closeCommentModal() { this.setData({ showCommentModal: false }); },

  // 7. UTILITIES
  onRefresh() {
    this.setData({ isRefreshing: true });
    this.fetchFeed();
  },

  onReachBottom() {
    this.fetchFeed(true);
  },

  onImagePreview(e) {
    const { current, urls } = e.currentTarget.dataset;
    wx.previewImage({ current, urls });
  }
});