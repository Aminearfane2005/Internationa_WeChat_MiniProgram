const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    statusBarHeight: 20,
    inputMessage: '',
    chatHistory: [],
    lastMessageId: '',
    isAdmin: false, // User side is false
    userInfo: {}
  },

  onLoad() {
    // 1. Get system info for the glassmorphism header
    const sys = wx.getSystemInfoSync();
    
    // 2. Get User Info from storage
    const userInfo = wx.getStorageSync('userInfo') || {
      nickName: 'User',
      avatarUrl: '/images/default-avatar.png'
    };

    this.setData({ 
      statusBarHeight: sys.statusBarHeight,
      userInfo
    });

    // 3. Start the Real-time Chat Listener
    this.initChatListener();
  },

  // Initialize Real-time Watcher (The "Engine")
  initChatListener() {
    // Note: To keep chats private, use .where({ _openid: '{YOUR_OPENID}' })
    this.messageWatcher = db.collection('support_messages')
      .orderBy('timestamp', 'asc')
      .watch({
        onChange: (snapshot) => {
          const formattedMsgs = snapshot.docs.map(msg => {
            if (msg.timestamp) {
              const d = new Date(msg.timestamp);
              msg.timeDisplay = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
            }
            return msg;
          });

          this.setData({
            chatHistory: formattedMsgs
          });

          // Trigger auto-scroll
          this.scrollToBottom(formattedMsgs.length);
        },
        onError: (err) => {
          console.error('Chat Watcher Error:', err);
        }
      });
  },
  goHome() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },
  onInput(e) {
    this.setData({ inputMessage: e.detail.value });
  },

  async sendMessage() {
    const content = this.data.inputMessage.trim();
    if (!content) return;

    try {
      await db.collection('support_messages').add({
        data: {
          text: content,
          isAdmin: false,
          timestamp: db.serverDate(),
        }
      });

      this.setData({ inputMessage: '' });
    } catch (err) {
      wx.showToast({ title: 'Send failed', icon: 'none' });
      console.error(err);
    }
  },

  scrollToBottom(count) {
    if (count > 0) {
      this.setData({
        lastMessageId: `msg-${count - 1}`
      });
    }
  },

  exitChat() {
    console.log("Attempting to exit chat...");
    
    // Attempt 1: Just go back (This is the cleanest way)
    wx.navigateBack({
      delta: 1,
      fail: (err) => {
        console.log("No page to go back to, switching to tab...");
        
        // Attempt 2: If back fails, switch to the profile tab
        wx.switchTab({
          url: '/pages/profile/profile',
          success: () => {
            console.log("Successfully switched to profile tab");
          },
          fail: (err2) => {
            console.error("SwitchTab failed. Check if profile is a tab in app.json", err2);
            
            // Attempt 3: Emergency relaunch if it's not a tab
            wx.reLaunch({
              url: '/pages/profile/profile'
            });
          }
        });
      }
    });
  },
  
  // CRITICAL: Stop the watcher to save battery/data when leaving
  onUnload() {
    if (this.messageWatcher) {
      this.messageWatcher.close();
      console.log("Real-time listener disconnected.");
    }
  }
});