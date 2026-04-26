Page({
    data: {
      provinceList: ['Beijing','Shanghai','Guangdong','Zhejiang','Jiangsu','Sichuan','Shaanxi','Yunnan','Fujian','Hainan','Tibet','Other'],
      provinceMap: {
        'Beijing': ['Beijing'],
        'Shanghai': ['Shanghai'],
        'Guangdong': ['Guangzhou', 'Shenzhen', 'Zhuhai', 'Foshan'],
        'Zhejiang': ['Hangzhou', 'Ningbo', 'Wenzhou'],
        'Jiangsu': ['Nanjing', 'Suzhou', 'Wuxi'],
        'Sichuan': ['Chengdu', 'Mianyang', 'Deyang'],
        'Shaanxi': ["Xi'an", 'Xianyang', 'Baoji'],
        'Yunnan': ['Kunming', 'Dali', 'Lijiang'],
        'Fujian': ['Xiamen', 'Fuzhou', 'Quanzhou'],
        'Hainan': ['Haikou', 'Sanya'],
        'Tibet': ['Lhasa'],
        'Other': ['Other']
      },
      provinceCities: [],
      maxImageCount: 9,
      showCityInput: false,
      isEdit: false,
    editId: null,

      // CRITICAL: Store both preview paths AND cloud file IDs
      tempImagePaths: [], // For preview only (wxfile://)
      cloudImageIDs: [],  // For database (cloud://)

      userInfo: {
        nickName: '',
        avatarUrl: ''
      },
      formData: {
        province: '',
        city: '',
        note: ''
      },
      scrollAreaHeight: 0,
    },

    onLoad() {
      this.loadUser();
      if (options.edit === 'true' && options.data) {
        const postData = JSON.parse(decodeURIComponent(options.data));
        this.setData({
          isEdit: true,
          editId: postData.id,
          subtitle: postData.subtitle,
          desc: postData.desc,
          dest: postData.dest,
          goDate: postData.goDate,
          spots: postData.spots,
          images: postData.images || []
        });
    }
    },

    onReady() {
      this.calculateScrollHeight();
    },

    onShow() {
      this.calculateScrollHeight();
    },

    calculateScrollHeight() {
      const query = wx.createSelectorQuery();
      const systemInfo = wx.getSystemInfoSync();
      const windowHeight = systemInfo.windowHeight;

      query.select('.page-header').boundingClientRect();
      query.select('.login-section').boundingClientRect();
      query.select('.user-info-section').boundingClientRect();
      query.select('.page-footer').boundingClientRect();

      query.exec((res) => {
        let usedHeight = 0;
        if (res[0]) usedHeight += res[0].height;
        if (this.data.userInfo) {
          if (res[2]) usedHeight += res[2].height;
        } else {
          if (res[1]) usedHeight += res[1].height;
        }
        if (res[3]) usedHeight += res[3].height;

        const scrollHeight = windowHeight - usedHeight;
        this.setData({
          scrollAreaHeight: scrollHeight > 0 ? scrollHeight : 400
        });
      });
    },

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
          nickName: user.username || user.nickName || 'Traveler',
          avatarUrl: user.avatar || user.avatarUrl || '/images/default-avatar.png'
        }
      });

      console.log('Loaded user:', this.data.userInfo);
    },

    onProvincePick(e) {
      const index = e.detail.value;
      const province = this.data.provinceList[index];
      const cities = this.data.provinceMap[province] || ['Other'];

      this.setData({
        'formData.province': province,
        'formData.city': '',
        provinceCities: cities,
        showCityInput: false
      });
    },

    onCityInProvincePick(e) {
      const index = e.detail.value;
      const city = this.data.provinceCities[index];

      this.setData({
        'formData.city': city,
        showCityInput: city === 'Other'
      });
    },

    // NEW: Toggle between city picker and custom city input
    toggleCityInput() {
      this.setData({
        showCityInput: !this.data.showCityInput,
        'formData.city': this.data.showCityInput ? '' : this.data.formData.city
      });
    },

    onCustomCityInput(e) {
      this.setData({
        'formData.city': e.detail.value
      });
    },

    onNoteInput(e) {
      this.setData({
        'formData.note': e.detail.value
      });
    },

    // ================= CRITICAL FIX: Proper Image Upload =================
    chooseImage() {
      const remainingCount = this.data.maxImageCount - this.data.cloudImageIDs.length;

      if (remainingCount <= 0) {
        wx.showToast({ title: 'Max 9 images', icon: 'none' });
        return;
      }

      wx.chooseMedia({
        count: remainingCount,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: async (res) => {
          const tempFiles = res.tempFiles;

          // Show preview immediately with local paths
          const newTempPaths = tempFiles.map(f => f.tempFilePath);
          this.setData({
            tempImagePaths: [...this.data.tempImagePaths, ...newTempPaths]
          });

          wx.showLoading({ title: `Uploading ${tempFiles.length} image(s)...` });

          try {
            // Upload each image to Cloud Storage
            const uploadPromises = tempFiles.map(file => {
              const cloudPath = `travel-images/${Date.now()}-${Math.random().toString(36).substr(2, 8)}.jpg`;
              return wx.cloud.uploadFile({
                cloudPath: cloudPath,
                filePath: file.tempFilePath
              });
            });

            const uploadResults = await Promise.all(uploadPromises);

            // Extract cloud file IDs (cloud://...)
            const newCloudIDs = uploadResults.map(r => r.fileID);

            // Save to data
            this.setData({
              cloudImageIDs: [...this.data.cloudImageIDs, ...newCloudIDs]
            });

            wx.hideLoading();
            wx.showToast({ title: 'Upload complete!', icon: 'success' });

            console.log('Uploaded images:', this.data.cloudImageIDs);

          } catch (err) {
            console.error('Upload failed:', err);
            wx.hideLoading();
            wx.showToast({ title: 'Upload failed: ' + err.message, icon: 'none' });

            // Remove failed previews
            this.setData({
              tempImagePaths: this.data.tempImagePaths.slice(0, -tempFiles.length)
            });
          }
        }
      });
    },

    deleteImage(e) {
      const index = e.currentTarget.dataset.index;

      // Remove from both arrays
      const newTempPaths = this.data.tempImagePaths.filter((_, i) => i !== index);
      const newCloudIDs = this.data.cloudImageIDs.filter((_, i) => i !== index);

      this.setData({
        tempImagePaths: newTempPaths,
        cloudImageIDs: newCloudIDs
      });
    },

    goBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({ url: '/pages/index/index' });
          }
        });
      } else {
        wx.switchTab({ url: '/pages/index/index' });
      }
    },

    // ================= UPDATED: Publish City Proposal =================
    publishPost() {
      const { formData, userInfo, cloudImageIDs } = this.data;

      // Validation - simplified for city proposal
      if (!formData.province || !formData.city) {
        wx.showToast({ title: 'Please select province and city', icon: 'none' });
        return;
      }
      if (cloudImageIDs.length === 0) {
        wx.showToast({ title: 'Please upload at least 1 image', icon: 'none' });
        return;
      }

      // Check user
      if (!userInfo.nickName) {
        wx.showToast({ title: 'User not loaded', icon: 'none' });
        this.loadUser();
        return;
      }

      const postData = {
        // User info
        name: userInfo.nickName,
        avatar: userInfo.avatarUrl,
        userInfo: {
          username: userInfo.nickName,
          avatar: userInfo.avatarUrl
        },

        // Post content - updated for city proposal
        subtitle: `Propose to travel to ${formData.city}`,
        desc: formData.note || `Check out ${formData.city}! A great destination worth visiting.`,
        cover: cloudImageIDs[0], // First image as cover
        images: cloudImageIDs, // ✅ CRITICAL: cloud:// paths, not wxfile://
        dest: formData.city,
        province: formData.province,

        // Stats
        likes: 0,
        comments: 0,
        commentList: [],

        // Metadata
        createTime: new Date(),
        status: 'active',
        type: 'city_proposal' // New field to identify city proposals
      };

      wx.showLoading({ title: 'Publishing...' });

      wx.cloud.database().collection('travelPosts').add({
        data: postData
      }).then((res) => {
        wx.hideLoading();
        console.log('Published with ID:', res._id);
        console.log('Images saved:', cloudImageIDs);
        wx.showToast({ title: 'Published!', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 1000);
      }).catch(err => {
        wx.hideLoading();
        console.error('Publish failed:', err);
        wx.showToast({ title: 'Failed: ' + err.message, icon: 'none' });
      });
    },

    goHome() {
      wx.switchTab({
        url: '/pages/index/index'
      });
    },
    async submitPost() {
        if (this.data.isEdit) {
          await this.updatePost();
        } else {
          await this.createPost();
        }
      },
    
      async updatePost() {
        const db = wx.cloud.database();
        const { editId, subtitle, desc, dest, goDate, spots, images } = this.data;
    
        wx.showLoading({ title: 'Updating...' });
    
        try {
          await db.collection('travelPosts').doc(editId).update({
            data: {
              subtitle,
              desc,
              dest,
              goDate,
              spots,
              images: images,
              updateTime: db.serverDate()
            }
          });
    
          wx.hideLoading();
          wx.showToast({ title: 'Updated successfully', icon: 'success' });
          
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        } catch (err) {
          wx.hideLoading();
          console.error('Update failed:', err);
          wx.showToast({ title: 'Update failed', icon: 'none' });
        }
      }
  });