const ROUTE_MAP = {
  travel: '/pages/travel/travel',
  secondHand: '/pages/secondHand/secondHand',
  community: '/pages/community/community',
  house: '/pages/house/house',
  sharing: '/pages/sharing/sharing'
};

const DEFAULT_STATS = [
  { value: '12K+', label: 'Active Students' },
  { value: '95%', label: 'Verified Profiles' },
  { value: '4.9', label: 'Community Rating' }
];

Page({
  data: {
    defaultAvatar: 'https://api.dicebear.com/9.x/adventurer/svg?seed=default',
    userInfo: null,
    greeting: '',
    isLoading: true,
    quickStats: DEFAULT_STATS
  },

  onLoad() {
    this.initSystem();
    this.loadUser();
  },

  onShow() {
    this.loadUser();
  },

  initSystem() {
    const hour = new Date().getHours();
    let greeting = 'Welcome back';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 18) greeting = 'Good afternoon';
    else greeting = 'Good evening';
    this.setData({ greeting });
  },

  loadUser() {
    const user = wx.getStorageSync('user');
    if (!user || !user.username) {
      wx.showToast({ title: 'Please create profile first', icon: 'none' });
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }

    this.setData({
      userInfo: {
        nickName: this.formatDisplayName(user.username),
        avatarUrl: user.avatar || this.data.defaultAvatar
      },
      quickStats: this.buildSmartStats(user),
      isLoading: false
    });
  },

  formatDisplayName(name) {
    if (!name || typeof name !== 'string') return 'Explorer';
    return name.trim().slice(0, 24);
  },

  buildSmartStats(user) {
    // Keep the premium social-proof feel while allowing lightweight personalization.
    const completedProfile = user && user.avatar ? '100%' : '80%';
    return [
      DEFAULT_STATS[0],
      { value: completedProfile, label: 'Profile Completion' },
      DEFAULT_STATS[2]
    ];
  },

  onCardTap(e) {
    const page = e.currentTarget.dataset.page;
    const targetUrl = ROUTE_MAP[page];

    if (!targetUrl) {
      wx.showToast({ title: 'Coming soon', icon: 'none' });
      return;
    }

    this.hapticLight();
    wx.navigateTo({
      url: targetUrl,
      fail: () => wx.showToast({ title: 'Page unavailable', icon: 'none' })
    });
  },

  hapticLight() {
    if (typeof wx.vibrateShort !== 'function') return;
    wx.vibrateShort({ type: 'light', fail: () => {} });
  },

  onPullDownRefresh() {
    this.initSystem();
    this.loadUser();
    wx.stopPullDownRefresh();
    wx.showToast({ title: 'Updated', icon: 'success' });
  },

  onShareAppMessage() {
    return {
      title: 'iAbroad - Your all-in-one student platform',
      path: '/pages/home/home'
    };
  }
});