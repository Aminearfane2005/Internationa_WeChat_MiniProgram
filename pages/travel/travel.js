Page({
    data: {
      list: [],
      userInfo: null,
      searchKeyword: '',
      activeCity: 'All',
      showOtherInput: false,
      customCity: '',
      activeFilter: 'All',
      isRefreshing: false,
      sharePostId: null,
      citySuggestions: [],
      showPostOptions: false,    // ADD THIS
      selectedPostId: null,      // ADD THIS
  
      showPostMenu: false,
  
      showCommentPopup: false,
      currentPostId: null,
      currentPost: {},
      commentText: '',

      showDeletePopup: false,
      postToDelete: null,
      currentUserId: null,
  
      showImagePreview: false,
      previewImages: [],
      currentPreviewIndex: 0,
      
      // Limits
      MAX_DESC_LENGTH: 300,
      MAX_IMAGES: 4,
      
      allCities: [
        'Beijing', 'Shanghai', "Xi'an", 'Yunnan', 'Chengdu', 'Hangzhou',
        'Guangzhou', 'Shenzhen', 'Zhuhai', 'Foshan', 'Ningbo', 'Wenzhou',
        'Nanjing', 'Suzhou', 'Wuxi', 'Mianyang', 'Deyang', 'Xianyang', 
        'Baoji', 'Kunming', 'Dali', 'Lijiang', 'Xiamen', 'Fuzhou', 
        'Quanzhou', 'Haikou', 'Sanya', 'Lhasa'
      ],
  
      allList: [],
      list: [],

      shouldRefresh: false,
  
      // DEBUG: Store conversion results for display
      debugInfo: {
        totalImages: 0,
        convertedImages: 0,
        failedImages: 0,
        errors: []
      }
    },
  
    onLoad() {
      // Initialize cloud first
      if (!wx.cloud) {
        console.error('Please use base library 2.2.3 or above');
        wx.showToast({ title: 'Please update WeChat', icon: 'none' });
      } else {
        wx.cloud.init({
          env: 'cloud1-6g4wi8hb5fafb28d',
          traceUser: true,
        });
      }
  
      this.getCurrentUserId();
      this.loadPostsFromCloud();
      this.getUserInfo();
    },

    onShow() {
      // Refresh posts when returning from edit/create page
      if (this.data.shouldRefresh) {
        this.loadPostsFromCloud();
        this.setData({ shouldRefresh: false });
      }
    },
  
    getUserInfo() {
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.userInfo']) {
            wx.getUserInfo({
              success: (res) => {
                this.setData({ userInfo: res.userInfo });
                wx.setStorageSync('userInfo', res.userInfo);
              }
            });
          }
        }
      });
    },
  
    formatTime(date) {
      if (!date) return 'Just now';
  
      const now = new Date();
      let postTime;
  
      if (typeof date === 'object' && date.getDate) {
        postTime = date;
      } else {
        postTime = new Date(date);
      }
  
      const diff = now.getTime() - postTime.getTime();
  
      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      const week = 7 * day;
  
      if (diff < minute) return 'Just now';
      if (diff < hour) return Math.floor(diff / minute) + ' min ago';
      if (diff < day) return Math.floor(diff / hour) + ' hours ago';
      if (diff < week) return Math.floor(diff / day) + ' days ago';
  
      const year = postTime.getFullYear();
      const month = (postTime.getMonth() + 1).toString().padStart(2, '0');
      const day_num = postTime.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day_num}`;
    },
  
    // ================= MERGED: loadPostsFromCloud with image conversion + isOwner =================
    async loadPostsFromCloud() {
      const db = wx.cloud.database();
      wx.showLoading({ title: 'Loading...' });
  
      try {
        const res = await db.collection('travelPosts')
          .orderBy('createTime', 'desc')
          .get();
  
        console.log('=== DEBUG: Raw posts count:', res.data.length);
  
        if (!res.data || res.data.length === 0) {
          this.setData({ allList: [], list: [] });
          wx.hideLoading();
          return;
        }
  
        const likedPosts = wx.getStorageSync('likedPosts') || {};
        const currentUserId = this.data.currentUserId;
  
        // DEBUG counters
        let debugInfo = {
          totalImages: 0,
          convertedImages: 0,
          failedImages: 0,
          errors: []
        };
  
        // STEP 1: Collect all cloud images that need conversion
        const cloudImagesToConvert = [];
        const postImageMap = new Map();
  
        res.data.forEach(post => {
          let images = [];
          if (post.images && Array.isArray(post.images)) {
            images = post.images.filter(img => img && typeof img === 'string');
          } else if (post.cover && typeof post.cover === 'string') {
            images = [post.cover];
          }
  
          postImageMap.set(post._id, images);
  
          images.forEach((img) => {
            if (img && img.startsWith('cloud://')) {
              cloudImagesToConvert.push(img);
              debugInfo.totalImages++;
            }
          });
        });
  
        console.log('=== DEBUG: Total cloud images to convert:', cloudImagesToConvert.length);
  
        // STEP 2: Get temp URLs for cloud images
        let tempUrlMap = {};
        if (cloudImagesToConvert.length > 0) {
          try {
            const uniqueCloudImages = [...new Set(cloudImagesToConvert)];
            console.log('=== DEBUG: Unique cloud images:', uniqueCloudImages.length);
  
            const tempRes = await wx.cloud.getTempFileURL({
              fileList: uniqueCloudImages
            });
  
            console.log('=== DEBUG: getTempFileURL full response:', JSON.stringify(tempRes, null, 2));
  
            if (tempRes.fileList && tempRes.fileList.length > 0) {
              tempRes.fileList.forEach((file, index) => {
                console.log(`=== DEBUG: File ${index}:`, {
                  fileID: file.fileID,
                  status: file.status,
                  hasTempURL: !!file.tempFileURL,
                  tempFileURL: file.tempFileURL ? file.tempFileURL.substring(0, 60) + '...' : 'EMPTY',
                  errMsg: file.errMsg
                });
  
                if (file.status === 0 && file.tempFileURL) {
                  tempUrlMap[file.fileID] = file.tempFileURL;
                  debugInfo.convertedImages++;
                } else {
                  debugInfo.failedImages++;
                  debugInfo.errors.push({
                    fileID: file.fileID,
                    status: file.status,
                    errMsg: file.errMsg
                  });
                  console.warn('=== DEBUG: FAILED - FileID:', file.fileID, 'Status:', file.status, 'Error:', file.errMsg);
                }
              });
            } else {
              console.error('=== DEBUG: fileList is empty or undefined!');
              debugInfo.errors.push({ error: 'fileList empty', response: tempRes });
            }
          } catch (err) {
            console.error('=== DEBUG: getTempFileURL error:', err);
            debugInfo.errors.push({ error: 'getTempFileURL exception', message: err.message });
          }
        }
  
        console.log('=== DEBUG: Conversion results:', {
          total: debugInfo.totalImages,
          converted: debugInfo.convertedImages,
          failed: debugInfo.failedImages,
          tempUrlMapKeys: Object.keys(tempUrlMap).length
        });
  
        // STEP 3: Process posts with converted images + isOwner check
        const processedPosts = res.data.map(post => {
          const originalImages = postImageMap.get(post._id) || [];
  
          // Convert cloud fileIDs to HTTP URLs
          const processedImages = [];
          originalImages.forEach((img, idx) => {
            if (!img) return;
  
            if (img.startsWith('http://') || img.startsWith('https://')) {
              processedImages.push(img);
              return;
            }
  
            if (img.startsWith('cloud://')) {
              const tempUrl = tempUrlMap[img];
              if (tempUrl) {
                processedImages.push(tempUrl);
              }
              return;
            }
  
            processedImages.push(img);
          });
  
          // User info
          let name = 'Traveler';
          let avatar = '/images/default-avatar.png';
  
          if (post.name && post.name !== '微信用户') name = post.name;
          if (post.avatar && post.avatar.trim()) avatar = post.avatar;
          if (post.userInfo?.nickName && post.userInfo.nickName !== '微信用户') name = post.userInfo.nickName;
          if (post.userInfo?.avatarUrl) avatar = post.userInfo.avatarUrl;
  
          const hasValidImages = processedImages.length > 0;
          
          // Check if current user is the owner
          const isOwner = currentUserId && (post.userId === currentUserId || post.openId === currentUserId);

          return {
            ...post,
            id: post._id,
            name,
            avatar,
            images: processedImages,
            originalImages: originalImages,
            hasValidImages: hasValidImages,
            isLiked: likedPosts[post._id] || false,
            likes: post.likes || 0,
            comments: post.comments || 0,
            commentList: post.commentList || [],
            displayTime: this.formatTime(post.createTime),
            isOwner: isOwner
          };
        });
  
        console.log('=== DEBUG: Final processed posts:', processedPosts.map(p => ({
          id: p.id,
          title: p.subtitle,
          isOwner: p.isOwner,
          imageCount: p.images.length
        })));
  
        this.setData({ 
          allList: processedPosts,
          list: processedPosts,
          debugInfo: debugInfo
        });
  
        this.applyFilters();
  
      } catch (err) {
        console.error('=== DEBUG: Load failed:', err);
        wx.showToast({ title: 'Load failed', icon: 'none' });
        this.setData({ allList: [], list: [] });
      } finally {
        wx.hideLoading();
      }
    },
  
    onRefresh() {
      this.setData({ isRefreshing: true });
      this.loadPostsFromCloud();
      setTimeout(() => {
        this.setData({ isRefreshing: false });
      }, 500);
    },
  
    onSearchInput(e) {
      const keyword = e.detail.value;
      const { allCities } = this.data;
  
      let suggestions = [];
      if (keyword && keyword.trim()) {
        const lowerKeyword = keyword.toLowerCase().trim();
        suggestions = allCities.filter(city => 
          city.toLowerCase().includes(lowerKeyword)
        ).slice(0, 5);
      }
  
      this.setData({ 
        searchKeyword: keyword,
        citySuggestions: suggestions
      });
  
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => this.applyFilters(), 300);
    },
  
    selectSuggestion(e) {
      const city = e.currentTarget.dataset.city;
      this.setData({
        searchKeyword: city,
        citySuggestions: [],
        activeCity: city
      });
      this.applyFilters();
    },
  
    onSearch() {
      this.setData({ citySuggestions: [] });
      this.applyFilters();
    },
  
    clearSearch() {
      this.setData({ 
        searchKeyword: '',
        citySuggestions: []
      });
      this.applyFilters();
    },
  
    onCityTap(e) {
      const city = e.currentTarget.dataset.city;
  
      if (city === 'All') {
        this.setData({ 
          activeCity: 'All',
          showOtherInput: false,
          customCity: '',
          searchKeyword: '',
          citySuggestions: []
        });
      } else if (city === 'Other') {
        this.setData({ 
          activeCity: 'Other', 
          showOtherInput: true 
        });
      } else {
        this.setData({ 
          activeCity: city, 
          showOtherInput: false, 
          customCity: '' 
        });
      }
  
      this.applyFilters();
    },
  
    onOtherCityTap() {
      this.setData({ activeCity: 'Other', showOtherInput: true });
    },
  
    onCustomCityInput(e) {
      this.setData({ customCity: e.detail.value });
    },
  
    onCustomCityConfirm() {
      if (!this.data.customCity.trim()) {
        wx.showToast({ title: 'Enter a city name', icon: 'none' });
        return;
      }
      this.setData({ 
        activeCity: this.data.customCity.trim(), 
        showOtherInput: false 
      });
      this.applyFilters();
    },
  
    selectFilter(e) {
      this.setData({ activeFilter: e.currentTarget.dataset.filter });
      this.applyFilters();
    },
  
    applyFilters() {
      const { allList = [], activeCity, activeFilter, searchKeyword, customCity, currentPostId } = this.data;
  
      let list = [];
      let currentPost = null;
  
      allList.forEach(post => {
        let match = true;
  
        if (activeCity && activeCity !== 'All') {
          if (activeCity === 'Other' && customCity) {
            if (!post.dest || !post.dest.toLowerCase().includes(customCity.toLowerCase())) match = false;
          } else if (post.dest !== activeCity) {
            match = false;
          }
        }
  
        if (searchKeyword && searchKeyword.trim()) {
          const kw = searchKeyword.toLowerCase().trim();
          const textMatch = 
            (post.desc && post.desc.toLowerCase().includes(kw)) ||
            (post.dest && post.dest.toLowerCase().includes(kw)) ||
            (post.name && post.name.toLowerCase().includes(kw)) ||
            (post.subtitle && post.subtitle.toLowerCase().includes(kw));
          if (!textMatch) match = false;
        }
  
        const postDate = post.goDate || post.date;
        if (activeFilter === 'This Week' && !this.isThisWeek(postDate)) match = false;
        if (activeFilter === 'This Month' && !this.isThisMonth(postDate)) match = false;
  
        if (match) {
          list.push(post);
        }
  
        if (post._id === currentPostId || post.id === currentPostId) currentPost = post;
      });
  
      this.setData({ 
        list,
        currentPost: currentPost || {}
      });
    },
  
    isThisWeek(dateStr) {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      const now = new Date();
      if (isNaN(date.getTime())) return false;
  
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
  
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
  
      return date >= startOfWeek && date <= endOfWeek;
    },
  
    isThisMonth(dateStr) {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      const now = new Date();
      if (isNaN(date.getTime())) return false;
  
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    },
  
    openTravelForm() {
      console.log('Navigating to createTravel page...');
      this.hidePostMenu();
      wx.navigateTo({
        url: '/pages/createTravel/createTravel',
        success: function() {
          console.log('Navigation success!');
        },
        fail: function(err) {
          console.error('Navigation failed:', err);
          wx.showToast({ title: 'Page not found', icon: 'none' });
        }
      });
    },
  
    goDetail(e) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      wx.navigateTo({ url: `/pages/travelDetail/travelDetail?id=${id}` });
    },
  
    onLike(e) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
  
      const allList = this.data.allList.map(item => {
        if (item.id === id || item._id === id) {
          const newLiked = !item.isLiked;
          const newLikes = newLiked ? (item.likes || 0) + 1 : Math.max(0, (item.likes || 0) - 1);
  
          const likedPosts = wx.getStorageSync('likedPosts') || {};
          likedPosts[id] = newLiked;
          wx.setStorageSync('likedPosts', likedPosts);
  
          return {
            ...item,
            isLiked: newLiked,
            likes: newLikes
          };
        }
        return item;
      });
  
      this.setData({ allList });
      this.applyFilters();
  
      const db = wx.cloud.database();
      const post = allList.find(p => p.id === id || p._id === id);
      if (post && post._id) {
        db.collection('travelPosts').doc(post._id).update({
          data: { likes: post.likes }
        });
      }
    },
  
    openComments(e) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
  
      const post = this.data.allList.find(item => item.id === id || item._id === id);
      this.setData({
        showCommentPopup: true,
        currentPostId: id,
        currentPost: post || {},
        commentText: ''
      });
    },
  
    closeComments() {
      this.setData({
        showCommentPopup: false,
        currentPostId: null,
        commentText: ''
      });
    },
  
    onCommentInput(e) {
      this.setData({ commentText: e.detail.value });
    },
  
    submitComment() {
      const { commentText, currentPostId, allList, userInfo } = this.data;
  
      if (!commentText.trim()) {
        wx.showToast({ title: 'Please enter comment', icon: 'none' });
        return;
      }
  
      const user = userInfo || wx.getStorageSync('userInfo') || {};
  
      const newComment = {
        id: Date.now(),
        avatar: user.avatarUrl || '/images/default-avatar.png',
        name: user.nickName || 'Traveler',
        content: commentText.trim(),
        time: 'Just now'
      };
  
      const updatedList = allList.map(post => {
        if (post.id === currentPostId || post._id === currentPostId) {
          const newCommentList = [...(post.commentList || []), newComment];
  
          const db = wx.cloud.database();
          if (post._id) {
            db.collection('travelPosts').doc(post._id).update({
              data: {
                comments: (post.comments || 0) + 1,
                commentList: newCommentList
              }
            });
          }
  
          return {
            ...post,
            comments: (post.comments || 0) + 1,
            commentList: newCommentList
          };
        }
        return post;
      });
  
      this.setData({
        allList: updatedList,
        commentText: '',
        currentPost: updatedList.find(p => p.id === currentPostId || p._id === currentPostId) || {}
      });
  
      wx.showToast({ title: 'Comment added!', icon: 'success' });
    },
  
    previewImage(e) {
      const { urls, current } = e.currentTarget.dataset;
      if (urls && urls.length > 0) {
        wx.previewImage({
          urls: urls,
          current: current || urls[0]
        });
      }
    },
  
    // Image load error handler
    onImageError(e) {
      console.error('=== DEBUG: Image load error:', e);
      const { idx } = e.currentTarget.dataset;
      console.log('=== DEBUG: Failed to load image at index:', idx);
  
      const { list } = this.data;
      const postId = e.currentTarget.dataset.postid;
      const post = list.find(p => p.id === postId || p._id === postId);
      if (post && post.images && post.images[idx]) {
        console.log('=== DEBUG: Failed image URL:', post.images[idx]);
      }
    },
  
    togglePostMenu() {
      this.setData({ 
        showPostMenu: !this.data.showPostMenu 
      });
    },
  
    creatpost() {
      this.setData({ showPostMenu: true });
    },
  
    hidePostMenu() {
      this.setData({ showPostMenu: false });
    },
  
    stopBubble() {},

    // Get current user's unique ID
    getCurrentUserId() {
      wx.cloud.callFunction({
        name: 'getOpenId',
        success: (res) => {
          this.setData({ currentUserId: res.result.openId });
          // Reload posts after getting user ID to set isOwner correctly
          this.loadPostsFromCloud();
        },
        fail: () => {
          const userId = wx.getStorageSync('userId') || Date.now().toString();
          wx.setStorageSync('userId', userId);
          this.setData({ currentUserId: userId });
          this.loadPostsFromCloud();
        }
      });
    },

    // Edit Post
      // Edit Post
  editPost() {
    const id = this.data.selectedPostId;
    if (!id) return;

    this.hidePostOptions(); // Close popup first

    const post = this.data.allList.find(item => item.id === id || item._id === id);
    
    if (!post) {
      wx.showToast({ title: 'Post not found', icon: 'none' });
      return;
    }

    if (!post.isOwner) {
      wx.showToast({ title: 'You can only edit your own posts', icon: 'none' });
      return;
    }

    const postData = {
      id: post._id,
      subtitle: post.subtitle,
      desc: post.desc,
      dest: post.dest,
      goDate: post.goDate,
      spots: post.spots,
      images: post.originalImages || post.images,
      isEdit: true
    };

    this.setData({ shouldRefresh: true });

    wx.navigateTo({
      url: `/pages/createTravel/createTravel?edit=true&data=${encodeURIComponent(JSON.stringify(postData))}`,
      fail: (err) => {
        console.error('Navigation failed:', err);
        wx.showToast({ title: 'Edit page not found', icon: 'none' });
      }
    });
  },

  // Delete Post - Show confirmation
  deletePost() {
    const id = this.data.selectedPostId;
    if (!id) return;

    this.hidePostOptions(); // Close popup first

    const post = this.data.allList.find(item => item.id === id || item._id === id);
    
    if (!post) {
      wx.showToast({ title: 'Post not found', icon: 'none' });
      return;
    }

    if (!post.isOwner) {
      wx.showToast({ title: 'You can only delete your own posts', icon: 'none' });
      return;
    }

    this.setData({
      showDeletePopup: true,
      postToDelete: {
        id: post._id,
        title: post.subtitle || 'this post'
      }
    });
  },

    // Confirm delete
    async confirmDelete() {
      const { postToDelete } = this.data;
      
      if (!postToDelete || !postToDelete.id) {
        this.hideDeletePopup();
        return;
      }

      wx.showLoading({ title: 'Deleting...' });

      try {
        const db = wx.cloud.database();
        await db.collection('travelPosts').doc(postToDelete.id).remove();

        const updatedAllList = this.data.allList.filter(item => 
          item.id !== postToDelete.id && item._id !== postToDelete.id
        );
        
        const updatedList = this.data.list.filter(item => 
          item.id !== postToDelete.id && item._id !== postToDelete.id
        );

        this.setData({
          allList: updatedAllList,
          list: updatedList,
          showDeletePopup: false,
          postToDelete: null
        });

        wx.showToast({ 
          title: 'Post deleted successfully', 
          icon: 'success' 
        });

      } catch (err) {
        console.error('Delete failed:', err);
        wx.showToast({ 
          title: 'Failed to delete post', 
          icon: 'none' 
        });
      } finally {
        wx.hideLoading();
        this.hideDeletePopup();
      }
    },

    // Cancel delete
    cancelDelete() {
      this.hideDeletePopup();
    },
  // Show post options popup (3-dots menu)
  showPostOptions(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    
    this.setData({
      showPostOptions: true,
      selectedPostId: id
    });
  },

  // Hide post options popup
  hidePostOptions() {
    this.setData({
      showPostOptions: false,
      selectedPostId: null
    });
  },
    // Hide delete popup
    hideDeletePopup() {
      this.setData({
        showDeletePopup: false,
        postToDelete: null
      });
    }
});