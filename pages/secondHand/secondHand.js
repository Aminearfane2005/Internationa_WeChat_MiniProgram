const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    currentTab: 'shop',
    isAdmin: false, 
    categories: ['Electronics', 'Furniture', 'Books', 'Clothing', 'Kitchen', 'Other'],
    activeCat: 'All',
    products: [],
    allProducts: [],
    pendingOrders: [],
    form: { 
      category: '', title: '', description: '', price: '', image: '', qr: '',
      phone: '',    // Added for Buyer
      address: ''   // Added for Buyer
    },
    showPayModal: false,
    activeItem: null
  },

  onLoad() {
    this.loadProducts();
    this.checkAdminStatus();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },
  goHome() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },
  // --- 1. NAVIGATION LOGIC ---
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    if (tab === 'shop') this.loadProducts();
    if (tab === 'admin') this.loadAdminTasks();
  },

  checkAdminStatus() {
    this.setData({ isAdmin: true }); 
  },

  // --- 2. SHOP LOGIC ---
  loadProducts() {
    wx.showLoading({ title: 'Loading Hub...' });
    db.collection('products')
      .where({ status: _.in(['available', 'completed']) })
      .orderBy('createTime', 'desc')
      .get()
      .then(res => {
        this.setData({ products: res.data, allProducts: res.data });
        wx.hideLoading();
      }).catch(err => {
        wx.hideLoading();
        console.error("Load failed", err);
      });
  },

  filterCat(e) {
    const cat = e.currentTarget.dataset.cat;
    this.setData({ activeCat: cat });
    if (cat === 'All') {
      this.setData({ products: this.data.allProducts });
    } else {
      const filtered = this.data.allProducts.filter(item => item.category === cat);
      this.setData({ products: filtered });
    }
  },

  // --- 3. SELLING LOGIC ---
  onIn(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ [`form.${f}`]: e.detail.value });
  },

  onCatChange(e) {
    this.setData({ 'form.category': this.data.categories[e.detail.value] });
  },

  chooseImage(e) {
    const type = e.currentTarget.dataset.type;
    wx.chooseImage({
      count: 1,
      success: (res) => {
        const key = type === 'product' ? 'form.image' : 'form.qr';
        this.setData({ [key]: res.tempFilePaths[0] });
      }
    });
  },

  async submitProduct() {
    const { title, price, image, qr, category, description } = this.data.form;
    if (!title || !price || !image || !qr || !category) {
      return wx.showToast({ title: 'Fill all * fields', icon: 'none' });
    }

    wx.showLoading({ title: 'Listing...' });
    try {
      const imgId = await this.uploadFile(image, 'products');
      const qrId = await this.uploadFile(qr, 'payout_qrs');

      await db.collection('products').add({
        data: {
          title, category, description,
          price: Number(price),
          image: imgId,
          sellerQR: qrId, // This is saved per-product
          status: 'available',
          createTime: db.serverDate()
        }
      });

      wx.hideLoading();
      this.setData({ form: { category: '', title: '', description: '', price: '', image: '', qr: '', phone: '', address: '' } });
      wx.showToast({ title: 'Listed!' });
      this.switchTab({ currentTarget: { dataset: { tab: 'shop' } } });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: 'Error: ' + err.errMsg, icon: 'none' });
    }
  },

  // --- 4. BUYER FLOW ---
  openBuyModal(e) {
    const item = e.currentTarget.dataset.item;
    if (item.status === 'completed') return;
    this.setData({ showPayModal: true, activeItem: item });
  },

  closeModal() {
    this.setData({ showPayModal: false });
  },

  async notifyPaid() {
    const { phone, address } = this.data.form;
    if (!phone || !address) {
      return wx.showToast({ title: 'Phone and Address required', icon: 'none' });
    }

    wx.showLoading({ title: 'Notifying Admin...' });
    try {
      await db.collection('transactions').add({
        data: {
          productId: this.data.activeItem._id,
          itemTitle: this.data.activeItem.title,
          price: this.data.activeItem.price,
          sellerQR: this.data.activeItem.sellerQR, // Uses the seller's specific QR
          buyerPhone: phone,
          buyerAddress: address,
          status: 'pending',
          createTime: db.serverDate()
        }
      });
      this.setData({ showPayModal: false, 'form.phone': '', 'form.address': '' });
      wx.hideLoading();
      wx.showModal({ title: 'Request Sent', content: 'Admin will verify payment and contact you.', showCancel: false });
    } catch (err) {
      wx.hideLoading();
    }
  },

  // --- 5. ADMIN LOGIC ---
  loadAdminTasks() {
    db.collection('transactions')
      .where({ status: 'pending' })
      .orderBy('createTime', 'desc')
      .get()
      .then(res => {
        this.setData({ pendingOrders: res.data });
      });
  },

  async handleAction(e) {
    const { id, status } = e.currentTarget.dataset;
    const order = this.data.pendingOrders.find(o => o._id === id);

    if (status === 'completed') {
      wx.showLoading({ title: 'Approving...' });
      try {
        await db.collection('transactions').doc(id).update({ data: { status: 'completed' } });
        await db.collection('products').doc(order.productId).update({ data: { status: 'completed' } });
        wx.hideLoading();
        wx.showToast({ title: 'Item Stamped!' });
        this.loadAdminTasks();
      } catch (err) {
        wx.hideLoading();
      }
    }
  },

  uploadFile(path, folder) {
    const extension = path.split('.').pop();
    return wx.cloud.uploadFile({
      cloudPath: `${folder}/${Date.now()}-${Math.floor(Math.random() * 1000)}.${extension}`,
      filePath: path
    }).then(res => res.fileID);
  }
});