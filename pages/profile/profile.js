const db = wx.cloud.database();

Page({
  data: {
    statusBarHeight: 20,

    userInfo: {
      nickName: '',
      avatarUrl: ''
    },

    username: '',   // 👈 used for filtering (NO openid)
    activeTab: 'community',
    isMonthlyWinner: false,

    stats: { postCount: 0, likes: 0 },

    tabs: [
      { id: 'community', title: 'Feed' },
      { id: 'house', title: 'Housing' },
      { id: 'travel', title: 'Trips' },
      { id: 'secondHand', title: 'Market' }
    ],

    myPosts: [],
    myTravel: [],
    myProducts: [],
    currentListData: []
  },

  // ===== LOAD PAGE =====
  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sys.statusBarHeight });

    this.loadUser();
  },

  onShow() {
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({ selected: 2 });
    }
  },

  // ===== LOAD USER =====
  loadUser() {
    const user = wx.getStorageSync('user');

    if (!user) {
      wx.showToast({
        title: 'Please login first',
        icon: 'none'
      });

      wx.redirectTo({
        url: '/pages/login/login'
      });
      return;
    }

    this.setData({
      userInfo: {
        nickName: user.username,
        avatarUrl: user.avatar
      },
      username: user.username   // 👈 IMPORTANT (used for filtering)
    }, () => {
      this.loadAllContent(); // load AFTER username is ready
    });
  },

  // ===== LOAD CONTENT (FILTER BY USERNAME) =====
  async loadAllContent() {
    wx.showLoading({ title: 'Loading...', mask: true });

    try {
      const username = this.data.username;

      const [posts, travel, products] = await Promise.all([
        db.collection('posts')
          .where({ authorName: username })   // 👈 FILTER HERE
          .get(),

        db.collection('travelPosts')
          .where({ authorName: username })   // 👈 FILTER HERE
          .get(),

        db.collection('products')
          .where({ authorName: username })   // 👈 FILTER HERE
          .get()
      ]);

      const totalLikes = posts.data.reduce(
        (acc, p) => acc + (p.likeCount || 0),
        0
      );

      const legendStatus = posts.data.some(
        p => p.author && p.author.isMonthlyWinner
      );

      this.setData({
        myPosts: posts.data,
        myTravel: travel.data,
        myProducts: products.data,
        'stats.postCount': posts.data.length,
        'stats.likes': totalLikes,
        isMonthlyWinner: legendStatus,
        currentListData: posts.data
      });

    } catch (err) {
      console.error(err);
      wx.showToast({
        title: 'Failed to load data',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  // ===== SWITCH TAB =====
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;

    const map = {
      community: this.data.myPosts,
      travel: this.data.myTravel,
      secondHand: this.data.myProducts,
      house: []
    };

    this.setData({
      activeTab: tab,
      currentListData: map[tab]
    });

    wx.vibrateShort({ type: 'medium' });
  },

  // ===== NAVIGATION =====
  goToPost() {
    wx.switchTab({
      url: '/pages/community/community'
    });
  },

  goToSupport() {
    wx.navigateTo({
      url: '/pages/support/support',
      fail: () => {
        wx.showToast({
          title: 'Page not found',
          icon: 'none'
        });
      }
    });
  }
});