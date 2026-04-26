// app.js
App({
  globalData: {
    userInfo: null
  },
  // app.js
    onLaunch() {
      // Initialize Cloud Base
      if (!wx.cloud) {
        console.error('Cloud not supported');
      } else {
        wx.cloud.init({
          env: 'your-env-id-here', // <-- REPLACE THIS with your actual env ID
          traceUser: true
        });
      }
    },
  
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('Please use a base library version of 2.2.3 or above')
    } else {
      wx.cloud.init({
        env: 'cloud1-6g4wi8hb5fafb28d', // Find this in your Cloud Console
        traceUser: true,
      })
    }
  }
})