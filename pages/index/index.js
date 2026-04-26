Page({

  data: {
    wechatId: '',
    username: '',
    avatar: '',
    defaultAvatar: 'https://api.dicebear.com/9.x/adventurer/svg?seed=default',
    isSubmitting: false,
    canSubmit: false,
    wechatError: '',
    usernameError: ''
  },

  // ===== INPUT HANDLERS =====
  onWechatInput(e) {
    const wechatId = this.sanitizeWechatId(e.detail.value);
    this.setData({
      wechatId
    });
    this.updateValidationState();
  },

  onUsernameInput(e) {
    const username = this.sanitizeUsername(e.detail.value);
    this.setData({
      username
    });
    this.updateValidationState();
  },

  // ===== CHOOSE IMAGE =====
  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          avatar: res.tempFilePaths[0]
        });
      },
      fail: () => {
        wx.showToast({
          title: 'Image selection failed',
          icon: 'none'
        });
      }
    });
  },

  // ===== RANDOM AVATAR (FIXED) =====
  generateAvatar() {
    const seed = Math.random().toString(36).substring(2, 10);

    const avatarUrl = `https://api.dicebear.com/9.x/adventurer/png?seed=${seed}&t=${Date.now()}`;

    this.setData({
      avatar: avatarUrl
    });
  },

  // ===== SUBMIT =====
  async onSubmit() {
    const { wechatId, username, avatar, defaultAvatar } = this.data;
    const { wechatError, usernameError } = this.getValidationErrors();
    if (wechatError || usernameError) {
      this.setData({
        wechatError,
        usernameError,
        canSubmit: false
      });
      return;
    }

    if (this.data.isSubmitting) return;
    this.setData({ isSubmitting: true });

    const userData = {
      wechatId,
      username,
      avatar: avatar || defaultAvatar
    };

    try {
      wx.setStorageSync('user', userData);
    } catch (e) {
      console.error('Storage error:', e);
    }

    try {
      // Sync to backend so profile persists with account openid.
      if (wx.cloud) {
        const resp = await wx.cloud.callFunction({
          name: 'login',
          data: {
            userInfo: {
              nickName: username,
              avatarUrl: userData.avatar
            }
          }
        });

        const result = resp && resp.result ? resp.result : {};
        if (result.success && result.user) {
          wx.setStorageSync('user', {
            ...userData,
            openid: result.openid,
            _id: result.user._id
          });
        }
      }

      wx.showToast({
        title: 'Profile saved',
        icon: 'success',
        duration: 800
      });

      setTimeout(() => {
        wx.switchTab({
          url: '/pages/home/home',
          fail: () => {
            wx.redirectTo({
              url: '/pages/home/home'
            });
          }
        });
      }, 800);
    } catch (err) {
      console.error('Submit failed:', err);
      wx.showToast({
        title: 'Saved locally, sync retry later',
        icon: 'none'
      });
      wx.redirectTo({ url: '/pages/home/home' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  // ===== ON LOAD =====
  onLoad() {
    this.restoreCachedProfile();
    this.updateValidationState();
  },

  restoreCachedProfile() {
    try {
      const cache = wx.getStorageSync('user');
      if (cache && typeof cache === 'object') {
        this.setData({
          wechatId: cache.wechatId || '',
          username: cache.username || '',
          avatar: cache.avatar || ''
        });
      }
    } catch (e) {
      console.error('Restore cache failed:', e);
    }

    if (!this.data.avatar) {
      this.generateAvatar();
    }
  },

  sanitizeWechatId(value) {
    return (value || '')
      .trim()
      .replace(/[^\w-]/g, '')
      .slice(0, 30);
  },

  sanitizeUsername(value) {
    return (value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  },

  getValidationErrors() {
    const { wechatId, username } = this.data;
    let wechatError = '';
    let usernameError = '';

    if (!wechatId) {
      wechatError = 'WeChat ID is required';
    } else if (wechatId.length < 4) {
      wechatError = 'Use at least 4 characters';
    }

    if (!username) {
      usernameError = 'Display name is required';
    } else if (username.length < 2) {
      usernameError = 'Use at least 2 characters';
    }

    return { wechatError, usernameError };
  },

  updateValidationState() {
    const { wechatError, usernameError } = this.getValidationErrors();
    this.setData({
      wechatError,
      usernameError,
      canSubmit: !wechatError && !usernameError
    });
  }

});