const db = wx.cloud.database();

Page({
  
  data: {
    statusBarHeight: 0,  // Add this
    activeTab: 'products',
    isAuthorized: false,
    inputPassword: '',
    correctPassword: '1234',
    pendingOrders: [],
    totalVolume: 0,
    pendingHouses: [],
    messages: [],
    replyText: '',
    lastMessageId: '',
    
    // Payment QR Codes
    adminWechatQR: '',
    adminAlipayQR: '',
    currentPaymentTab: 'wechat',
    
    // Sharing Products Data
    groups: [],
    categoryNames: ['Food', 'Daily', 'Electronics', 'Beauty', 'Study'],
    categoryIndex: 0,
    productForm: {
      productName: '',
      category: '',
      categoryName: '',
      description: '',
      originalPrice: '',
      groupPrice: '',
      productImage: '',
      targetMembers: '10'
    }
  },
  
  onLoad() {
    const systemInfo = wx.getSystemInfoSync();
    this.setData({ 
        statusBarHeight: systemInfo.statusBarHeight,
      isAuthorized: false,
      inputPassword: ''
    });
  },

  onShow() {
    if (this.data.isAuthorized) {
      this.refreshData();
      this.loadAdminQRCodes();
    }
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({ selected: 1 });
    }
  },

  onUnload() {
    this.setData({ 
      isAuthorized: false,
      inputPassword: ''
    });
    if (this.messageWatcher) {
      this.messageWatcher.close();
    }
  },

  // ================= LOGIN =================
  
  onPasswordInput(e) {
    this.setData({ inputPassword: e.detail.value });
  },

  checkLogin() {
    const { inputPassword, correctPassword } = this.data;
    
    if (!inputPassword) {
      wx.showToast({ title: 'Enter password', icon: 'none' });
      return;
    }
    
    if (inputPassword === correctPassword) {
      this.setData({ isAuthorized: true });
      wx.showToast({ title: 'Welcome Admin!', icon: 'success' });
      this.refreshData();
      this.loadAdminQRCodes();
    } else {
      wx.showToast({ title: 'Wrong password!', icon: 'none' });
      this.setData({ inputPassword: '' });
    }
  },

  logout() {
    this.setData({ 
      isAuthorized: false, 
      inputPassword: '',
      groups: [],
      pendingOrders: [],
      messages: []
    });
    wx.showToast({ title: 'Logged out', icon: 'success' });
  },

  // ================= TAB SWITCHING =================

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    
    this.setData({ activeTab: tab });
    
    if (tab === 'support' && !this.messageWatcher) {
      this.initMessageWatcher();
    }
    
    if (tab === 'products') {
      this.loadSharingProducts();
      this.loadAdminQRCodes();
    }
  },

  // ================= PAYMENT QR CODE MANAGEMENT - FIXED =================
  
  switchPaymentTab(e) {
    this.setData({ currentPaymentTab: e.currentTarget.dataset.tab });
  },
  
  async uploadAdminQR() {
    const type = this.data.currentPaymentTab;
    const maxRetries = 3;
    let retryCount = 0;
  
    const attemptUpload = async () => {
      return new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          success: (res) => {
            const tempPath = res.tempFiles[0].tempFilePath;
            wx.showLoading({ title: 'Uploading...' });
            
            const cloudPath = `admin-qr/${type}-${Date.now()}.jpg`;
            
            wx.cloud.uploadFile({
              cloudPath: cloudPath,
              filePath: tempPath,
              success: async (uploadRes) => {
                const fileID = uploadRes.fileID;
                const field = type === 'wechat' ? 'adminWechatQR' : 'adminAlipayQR';
                
                // Update local state immediately
                this.setData({ [field]: fileID });
                
                try {
                  // Try to update existing document first
                  await db.collection('admin_settings').doc('payment').update({
                    data: {
                      [type + 'QR']: fileID,
                      updatedAt: db.serverDate()
                    }
                  });
                  wx.showToast({ title: 'QR Saved!', icon: 'success' });
                  wx.hideLoading();
                  resolve(true);
                } catch (updateErr) {
                  // If update fails (document doesn't exist), create it
                  console.log('Update failed, trying to create document:', updateErr);
                  try {
                    await db.collection('admin_settings').add({
                      data: {
                        _id: 'payment',
                        wechatQR: type === 'wechat' ? fileID : (this.data.adminWechatQR || ''),
                        alipayQR: type === 'alipay' ? fileID : (this.data.adminAlipayQR || ''),
                        createdAt: db.serverDate(),
                        updatedAt: db.serverDate()
                      }
                    });
                    wx.showToast({ title: 'QR Saved!', icon: 'success' });
                    wx.hideLoading();
                    resolve(true);
                  } catch (addErr) {
                    console.error('Failed to Create document:', addErr);
                    wx.showToast({ title: 'Save failed', icon: 'none' });
                    wx.hideLoading();
                    reject(addErr);
                  }
                }
              },
              fail: (err) => {
                console.error('Upload failed:', err);
                wx.hideLoading();
                reject(err);
              }
            });
          },
          fail: (err) => {
            console.error('Choose media failed:', err);
            wx.hideLoading();
            reject(err);
          }
        });
      });
    };
    
    // Retry logic wrapper
    while (retryCount < maxRetries) {
      try {
        await attemptUpload();
        return; // Success
      } catch (err) {
        retryCount++;
        console.error(`Upload attempt ${retryCount} failed:`, err);
        
        if (retryCount < maxRetries) {
          wx.showToast({ 
            title: `Network error, retrying... (${retryCount}/${maxRetries})`, 
            icon: 'none',
            duration: 1500
          });
          // Wait before retry
          await new Promise(r => setTimeout(r, 1000 * retryCount));
        } else {
          wx.showToast({ 
            title: 'Upload failed, please check network', 
            icon: 'none',
            duration: 3000
          });
          // Show more detailed error info
          wx.showModal({
            title: 'Upload Failed',
            content: 'Please check your network connection and try again. Error: ' + (err.errMsg || err.message || 'Unknown error'),
            showCancel: false
          });
        }
      }
    }
  },

  /// Load saved QR codes - converts cloud IDs to temp URLs for display
  async loadAdminQRCodes() {
    try {
      console.log('Loading QR codes from database...');
      const res = await db.collection('admin_settings').doc('payment').get();

      if (res.data) {
        let wechatQR = res.data.wechatQR || '';
        let alipayQR = res.data.alipayQR || '';

        console.log('Raw from DB:', { wechatQR: wechatQR ? 'exists' : 'empty', alipayQR: alipayQR ? 'exists' : 'empty' });

        // Convert cloud file IDs to temp URLs for display
        const cloudIds = [];
        const idMap = {};

        if (wechatQR && wechatQR.startsWith('cloud://')) {
          cloudIds.push(wechatQR);
          idMap[wechatQR] = 'wechat';
        }

        if (alipayQR && alipayQR.startsWith('cloud://')) {
          cloudIds.push(alipayQR);
          idMap[alipayQR] = 'alipay';
        }

        if (cloudIds.length > 0) {
          console.log('Converting', cloudIds.length, 'cloud files to temp URLs...');
          const tempRes = await wx.cloud.getTempFileURL({ fileList: cloudIds });

          tempRes.fileList.forEach(file => {
            if (file.status === 0 && file.tempFileURL) {
              const type = idMap[file.fileID];
              if (type === 'wechat') wechatQR = file.tempFileURL;
              if (type === 'alipay') alipayQR = file.tempFileURL;
            }
          });
        }

        console.log('Final URLs ready for display');

        this.setData({
          adminWechatQR: wechatQR,
          adminAlipayQR: alipayQR
        });
      }
    } catch (err) {
      // Document doesn't exist yet - this is normal for first time use
      if (err.errCode === -502001 || err.message.includes('cannot find document')) {
        console.log('No payment settings found - will create on first upload');
        this.setData({ adminWechatQR: '', adminAlipayQR: '' });
      } else {
        console.error('QR load error:', err);
        this.setData({ adminWechatQR: '', adminAlipayQR: '' });
      }
    }
  },

   // ================= PRODUCT MANAGEMENT =================

  onCategoryChange(e) {
    const index = e.detail.value;
    const name = this.data.categoryNames[index];
    
    this.setData({
      categoryIndex: index,
      'productForm.categoryName': name,
      'productForm.category': name.toLowerCase()
    });
  },

  onProdInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`productForm.${field}`]: e.detail.value
    });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.uploadImageToCloud(tempFilePath);
      }
    });
  },

  async uploadImageToCloud(tempFilePath) {
    wx.showLoading({ title: 'Uploading...' });
    
    const cloudPath = `product-images/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;

    try {
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: tempFilePath
      });

      this.setData({
        'productForm.productImage': uploadRes.fileID
      });
      
      wx.showToast({ title: 'Image Uploaded' });
    } catch (err) {
      console.error("Upload failed", err);
      wx.showToast({ title: 'Upload failed', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async submitProduct() {
    const form = this.data.productForm;
    
    if (!form.productName.trim()) {
      wx.showToast({ title: 'Enter product name', icon: 'none' });
      return;
    }
    
    if (!form.originalPrice && !form.groupPrice) {
      wx.showToast({ title: 'Enter price', icon: 'none' });
      return;
    }

    wx.showLoading({ title: 'Publishing...' });

    try {
      const deadline = this.getNextDeadline(new Date());

      const productData = {
        productName: form.productName.trim(),
        productImage: form.productImage || '',
        category: form.category || 'other',
        categoryName: form.categoryName || 'Other',
        description: form.description || '',
        originalPrice: parseFloat(form.originalPrice) || 0,
        groupPrice: parseFloat(form.groupPrice) || parseFloat(form.originalPrice) || 0,
        targetMembers: parseInt(form.targetMembers) || 10,
        currentMembers: 0,
        location: 'Campus',
        status: 'active',
        deadline: deadline,
        createdAt: db.serverDate()
      };

      await db.collection('products').add({
        data: productData
      });

      wx.showToast({ title: 'Published!', icon: 'success' });
      
      this.setData({
        productForm: {
          productName: '',
          category: '',
          categoryName: '',
          description: '',
          originalPrice: '',
          groupPrice: '',
          productImage: '',
          targetMembers: '10'
        },
        categoryIndex: 0
      });

      this.loadSharingProducts();

    } catch (err) {
      console.error("Publish failed:", err);
      wx.showToast({ title: 'Publish failed', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async loadSharingProducts() {
    try {
      const res = await db.collection('products')
        .where({ status: 'active' })
        .orderBy('createdAt', 'desc')
        .get();
      
      const processed = res.data.map(product => {
        const deadline = product.deadline ? new Date(product.deadline) : new Date();
        const now = new Date();
        const diff = deadline - now;
        
        const hoursLeft = Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
        const minutesLeft = Math.max(0, Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)));
        
        let deadlineCountdown;
        if (hoursLeft === 0) {
          deadlineCountdown = `${minutesLeft}m`;
        } else {
          deadlineCountdown = `${hoursLeft}h ${minutesLeft}m`;
        }
        
        const discount = product.originalPrice > product.groupPrice ? 
          Math.round(((product.originalPrice - product.groupPrice) / product.originalPrice) * 100) : 0;
        
        return {
          ...product,
          hoursLeft,
          deadlineCountdown,
          endsToday: hoursLeft < 24,
          discount,
          isFull: (product.currentMembers || 0) >= (product.targetMembers || 5)
        };
      });
      
      this.setData({ groups: processed });
      
    } catch (err) {
      console.error("Products Fetch Error:", err);
    }
  },

  async deleteProduct(e) {
    const id = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: 'Delete Product?',
      content: 'Remove from sharing page?',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: 'Deleting...' });
          
          try {
            await db.collection('products').doc(id).update({
              data: { status: 'deleted' }
            });
            
            wx.showToast({ title: 'Deleted' });
            this.loadSharingProducts();
            
          } catch (err) {
            wx.showToast({ title: 'Delete failed', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  getNextDeadline(date) {
    const now = new Date(date);
    const fivePM = new Date(now);
    fivePM.setHours(17, 0, 0, 0);
    
    if (now > fivePM) {
      fivePM.setDate(fivePM.getDate() + 1);
    }
    
    return fivePM;
  },

  // ================= REFRESH DATA =================

  async refreshData() {
    wx.showLoading({ title: 'Syncing...' });
    await Promise.all([
      this.loadTransactionData(),
      this.loadHousingData(),
      this.loadSharingProducts(),
      this.loadAdminQRCodes()
    ]);
    wx.hideLoading();
  },

  // ================= SUPPORT CHAT =================

  initMessageWatcher() {
    this.messageWatcher = db.collection('support_messages')
      .orderBy('timestamp', 'asc')
      .limit(50)
      .watch({
        onChange: (snapshot) => {
          const formattedMsgs = snapshot.docs.map(msg => {
            if (msg.timestamp) {
              const d = new Date(msg.timestamp);
              msg.timeDisplay = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
            }
            return msg;
          });
          this.setData({ messages: formattedMsgs });
          this.scrollToBottom();
        },
        onError: (err) => console.error("Chat Watch Error:", err)
      });
  },

  async sendReply(e) {
    const { userid } = e.currentTarget.dataset;
    const content = this.data.replyText;
    
    if (!content.trim()) return;
    
    try {
      await db.collection('support_messages').add({
        data: { 
          text: content, 
          isAdmin: true, 
          senderId: userid, 
          timestamp: db.serverDate() 
        }
      });
      this.setData({ replyText: '' });
    } catch (err) { 
      console.error("Reply failed:", err); 
    }
  },

  onReplyInput(e) {
    this.setData({ replyText: e.detail.value });
  },

  scrollToBottom() {
    this.setData({ 
      lastMessageId: `msg-${this.data.messages.length - 1}` 
    });
  },

  // ================= OTHER DATA =================

  async loadTransactionData() {
    try {
      const res = await db.collection('transactions')
        .where({ status: 'pending' })
        .orderBy('createTime', 'desc')
        .get();
      const total = res.data.reduce((sum, item) => sum + Number(item.price), 0); 
      this.setData({ pendingOrders: res.data, totalVolume: total });
    } catch (err) { 
      console.error("Transaction Fetch Error:", err); 
    }
  },

  async loadHousingData() {
    try {
      const res = await db.collection('houses')
        .orderBy('createdAt', 'desc')
        .get();
      this.setData({ pendingHouses: res.data });
    } catch (err) { 
      console.error("Housing Fetch Error:", err); 
    }
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.src;
    wx.previewImage({ urls: [url] });
  },
  

  async handleOrderAction(e) {
    const { id, status } = e.currentTarget.dataset; 
    const order = this.data.pendingOrders.find(o => o._id === id); 
    
    wx.showModal({
      title: 'Confirm Action',
      content: `Mark as ${status}?`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading();
          try {
            await db.collection('transactions').doc(id).update({
              data: { status: status, updateTime: db.serverDate() }
            });
            
            if (status === 'completed' && order && order.productId) {
              await db.collection('products').doc(order.productId).update({
                data: { status: 'completed' }
              });
            }
            
            this.loadTransactionData();
            wx.showToast({ title: 'Success' });
          } catch (err) { 
            console.error("Update failed", err); 
          } finally { 
            wx.hideLoading(); 
          }
        }
      }
    });
  },
  
  // Tab Bar Switch Handler
  onTabSwitch(e) {
    const { page } = e.detail;
    const pages = {
        'home': '/pages/home/home',
        'travel': '/pages/travel/travel',
        'secondHand': '/pages/secondHand/secondHand',
        'community': '/pages/community/community',
        'profile': '/pages/profile/profile',
        'admin': '/pages/admin/admin'
    };
    
    if (pages[page]) {
        wx.switchTab({
            url: pages[page],
            fail: () => {
                wx.navigateTo({ url: pages[page] });
            }
        });
    }
  }
});