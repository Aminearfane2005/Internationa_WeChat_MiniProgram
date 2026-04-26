Component({
    data: {
      color: "#7A7E83",
      selectedColor: "#3cc51f",
      selected: 0,
      list: [
        { pagePath: "/pages/home/home", text: "Home", icon: "🏠", selectedIcon: "🏠" },
        { pagePath: "/pages/admin/admin", text: "Admin", icon: "⚙️", selectedIcon: "⚙️" },
        { pagePath: "/pages/profile/profile", text: "Profile", icon: "👤", selectedIcon: "👤" }
      ]
    },
  
    // Auto-detect current page when shown
    pageLifetimes: {
      show() {
        this.updateSelected();
      }
    },
  
    lifetimes: {
      attached() {
        this.updateSelected();
      }
    },
  
    methods: {
      updateSelected() {
        const pages = getCurrentPages();
        if (!pages.length) return;
        
        const currentRoute = pages[pages.length - 1].route;
        
        const index = this.data.list.findIndex(item => {
          // Compare without leading slashes
          const cleanPath = item.pagePath.replace(/^\//, '');
          return currentRoute === cleanPath;
        });
        
        if (index !== -1) {
          this.setData({ selected: index });
        }
      },
  
      switchTab(e) {
        const { path, index } = e.currentTarget.dataset;
        
        // Update immediately for visual feedback
        this.setData({ selected: index });
        
        wx.switchTab({
          url: path,
          fail: () => wx.reLaunch({ url: path })
        });
      }
    }
  });