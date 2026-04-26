const db = wx.cloud.database({ env: "cloud1-6g4wi8hb5fafb28d" })
const housesCollection = db.collection('houses')

Page({
  data: {
    activeTab: 'view',
    scrollHeight: 0,
    houses: [],
    images: [], // only local file paths
    price: '',
    description: '',
    phone: '',
    address: ''
  },

  onLoad() {
    this.calculateScrollHeight()
    this.loadHouses()
  },

  calculateScrollHeight() {
    wx.getSystemInfo({
      success: res => {
        const rpxHeight = res.windowHeight * (750 / res.windowWidth)
        this.setData({ scrollHeight: rpxHeight - 460 - 10 })
      }
    })
  },
  goHome() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
    if (e.currentTarget.dataset.tab === 'view') this.loadHouses()
  },

  // ================= VIEW HOUSES =================
  loadHouses() {
    housesCollection
      .where({ isApproved: false })
      .orderBy('createdAt', 'desc')
      .get()
      .then(res => this.setData({ houses: res.data }))
      .catch(err => console.error(err))
  },

  // REMOVED: openChat function - no longer needed
  // The button now uses open-type="contact" which opens customer service directly

  // ================= ADD HOUSE =================
  chooseImages() {
    wx.chooseImage({
      count: 9,
      success: res => {
        // append new images to existing ones
        this.setData({ images: [...this.data.images, ...res.tempFilePaths] })
      }
    })
  },

  onPriceInput(e) { this.setData({ price: e.detail.value }) },
  onDescInput(e) { this.setData({ description: e.detail.value }) },
  onPhoneInput(e) { this.setData({ phone: e.detail.value }) },
  onAddressInput(e) { this.setData({ address: e.detail.value }) },

  submitHouse() {
    const { images, price, description, phone, address } = this.data

    if (!images.length || !price || !description) {
      wx.showToast({ title: 'Please fill all required fields', icon: 'none' })
      return
    }

    wx.showLoading({ title: 'Submitting...' })

    // Upload all images
    const uploadTasks = images.map((filePath, index) => {
      const cloudPath = `houses/${Date.now()}_${Math.floor(Math.random() * 10000)}_${index}.jpg`
      return wx.cloud.uploadFile({ cloudPath, filePath })
    })

    Promise.all(uploadTasks)
      .then(resArr => {
        const cloudFileIDs = resArr.map(r => r.fileID)
        return housesCollection.add({
          data: {
            price: Number(price),
            description,
            images: cloudFileIDs,
            phone,
            address,
            isApproved: false,
            createdAt: new Date()
          }
        })
      })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: 'Submitted for review', icon: 'success' })
        this.setData({
          images: [],
          price: '',
          description: '',
          phone: '',
          address: '',
          activeTab: 'view'
        })
        this.loadHouses()
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: 'Submission failed', icon: 'none' })
        console.error(err)
      })
  }
})