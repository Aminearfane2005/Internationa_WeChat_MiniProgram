// pages/sharing/sharing.js
const db = wx.cloud.database();

Page({
    data: {
        // QR Codes - Admin uploads these for buyers to scan
        adminWechatQR: '',
        adminAlipayQR: '',
        
        // Platform detection
        platform: 'devtools',
        
        // Buyer's QR Code - Buyer uploads for admin to scan
        buyerQRCode: '',
        isSearchExpanded: false,
        searchKeyword: '',
        
        categoryNames: ['Food', 'Daily', 'Electronics', 'Beauty', 'Study', 'Other'],
        filteredGroups: [],
        activeTab: 'popular',
        newsList: [
            { id: 1, text: 'New products added daily!' },
            { id: 2, text: 'Free delivery on orders over ¥50' },
            { id: 3, text: 'Join group buy to save more!' }
        ],
        globalCountdown: '23:59:59',
        showCreateModal: false,
        editingProduct: null,
        productForm: {
            productName: '',
            category: '',
            categoryName: '',
            description: '',
            originalPrice: '',
            groupPrice: '',
            targetMembers: '',
            productImage: ''
        },
        showPaymentModal: false,
        selectedGroup: {},
        paymentMethod: 'wechat',
        payerName: '',
        paidAmount: '',
        transactionId: '',
        showDescModal: false,
        descProduct: {},
        isAdmin: false
    },
    
    onLaunch: function () {
        if (wx.cloud) {
            wx.cloud.init({
                env: 'cloud1-6g4wi8hb5fafb28d',
                traceUser: true
            });
        }
    },
    
    onLoad() {
        try {
            const systemInfo = wx.getSystemInfoSync();
            this.setData({ platform: systemInfo.platform || 'devtools' });
        } catch (e) {
            this.setData({ platform: 'devtools' });
        }
        
        this.startCountdown();
        this.startProductCountdownUpdater();
    },

    onShow() {
        this.loadProducts();
        this.loadAdminQRCodes();
        setTimeout(() => this.retryLoadFailedImages && this.retryLoadFailedImages(), 3000);
    },

    onUnload() {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        if (this.productCountdownInterval) clearInterval(this.productCountdownInterval);
    },

    // ================= LOAD ADMIN QR CODES - FIXED =================
    async loadAdminQRCodes() {
        console.log('=== Loading Admin QR Codes ===');
        
        try {
            // Try to find by type field first (more flexible)
            let res = await db.collection('admin_settings')
                .where({ type: 'payment' })
                .limit(1)
                .get();
            
            // If not found by type, try by _id for backward compatibility
            if (res.data.length === 0) {
                try {
                    const idRes = await db.collection('admin_settings')
                        .doc('payment')
                        .get();
                    if (idRes.data) {
                        res = { data: [idRes.data] };
                    }
                } catch (idErr) {
                    console.log('No document with _id "payment" either');
                }
            }
            
            if (res.data.length > 0) {
                const doc = res.data[0];
                let wechatQR = doc.wechatQR || '';
                let alipayQR = doc.alipayQR || '';
                
                console.log('Raw from DB:', { 
                    wechatQR: wechatQR ? 'exists' : 'empty', 
                    alipayQR: alipayQR ? 'exists' : 'empty' 
                });
                
                // Convert cloud file IDs to temp URLs
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
                    try {
                        const tempRes = await wx.cloud.getTempFileURL({ 
                            fileList: cloudIds 
                        });
                        
                        if (tempRes && tempRes.fileList) {
                            tempRes.fileList.forEach(file => {
                                if (file.status === 0 && file.tempFileURL) {
                                    const type = idMap[file.fileID];
                                    if (type === 'wechat') wechatQR = file.tempFileURL;
                                    if (type === 'alipay') alipayQR = file.tempFileURL;
                                }
                            });
                        }
                    } catch (tempErr) {
                        console.error('getTempFileURL error:', tempErr);
                    }
                }
                
                this.setData({
                    adminWechatQR: wechatQR,
                    adminAlipayQR: alipayQR
                });
                
                console.log('QR codes loaded successfully');
                return;
            }
            
            // No document found at all - create one
            console.log('No payment settings found, creating...');
            await this.createDefaultPaymentDoc();
            
        } catch (err) {
            console.error('Error loading QR codes:', err);
            this.setData({
                adminWechatQR: '',
                adminAlipayQR: ''
            });
        }
    },
    
    // Helper function to create default document
    async createDefaultPaymentDoc() {
        try {
            await db.collection('admin_settings').add({
                data: {
                    type: 'payment',
                    wechatQR: '',
                    alipayQR: '',
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate()
                }
            });
            console.log('Created default payment document');
        } catch (err) {
            console.error('Failed to create default document:', err);
        }
        
        this.setData({
            adminWechatQR: '',
            adminAlipayQR: ''
        });
    },

    // ================= LOAD PRODUCTS =================
    async loadProducts() {
        wx.showLoading({ title: 'Loading...' });
        
        try {
            const res = await db.collection('products')
                .where({ status: 'active' })
                .orderBy('createdAt', 'desc')
                .get();
            
            if (res.data.length === 0) {
                this.setData({ filteredGroups: [] });
                wx.hideLoading();
                return;
            }
            
            const processed = this.processProductsWithCountdown(res.data);
            this.setData({ filteredGroups: processed });
            
        } catch (err) {
            console.error('Load products failed:', err);
            wx.showToast({ 
                title: 'Load failed: ' + (err.message || 'Unknown error'), 
                icon: 'none',
                duration: 3000
            });
        } finally {
            wx.hideLoading();
        }
    },

    // ================= PRODUCT COUNTDOWN LOGIC =================
    processProductsWithCountdown(products) {
        const now = new Date();
        
        return products.map(product => {
            let deadlineDate = this.calculateDeadline(product.createdAt);
            const diff = deadlineDate - now;
            const isExpired = diff <= 0;
            
            let countdownText = '';
            if (!isExpired) {
                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                countdownText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
                countdownText = 'Sold Out';
            }
            
            const discount = (product.originalPrice && product.groupPrice && product.originalPrice > product.groupPrice) ? 
                Math.round(((product.originalPrice - product.groupPrice) / product.originalPrice) * 100) : 0;
            
            let productImage = product.productImage || '';
            let imageError = !productImage;
            
            return {
                ...product,
                id: product._id,
                groupPrice: product.groupPrice || 0,
                productImage: productImage,
                imageError: imageError,
                productName: product.productName || 'Unnamed Product',
                category: product.category || 'other',
                deadlineCountdown: countdownText,
                isExpired: isExpired,
                endsToday: !isExpired && (diff < 24 * 3600000),
                discount: discount,
                isFull: (product.currentMembers || 0) >= (product.targetMembers || 10),
                location: product.location || 'Campus',
                _deadline: deadlineDate.getTime()
            };
        });
    },

    calculateDeadline(createdAt) {
        let created;
        if (createdAt && typeof createdAt === 'object' && createdAt.getTime) {
            created = createdAt;
        } else if (createdAt && typeof createdAt === 'number') {
            created = new Date(createdAt);
        } else if (createdAt && typeof createdAt === 'string') {
            created = new Date(createdAt);
        } else {
            created = new Date();
        }
        
        const deadline = new Date(created);
        deadline.setDate(deadline.getDate() + 1);
        deadline.setHours(17, 0, 0, 0);
        
        return deadline;
    },

    startProductCountdownUpdater() {
        this.updateProductCountdowns();
        this.productCountdownInterval = setInterval(() => {
            this.updateProductCountdowns();
        }, 1000);
    },

    updateProductCountdowns() {
        const now = new Date();
        const products = this.data.filteredGroups;
        let hasChanges = false;
        
        const updated = products.map(product => {
            if (!product._deadline || product.isExpired) {
                return product;
            }
            
            const diff = product._deadline - now;
            
            if (diff <= 0) {
                hasChanges = true;
                return {
                    ...product,
                    isExpired: true,
                    deadlineCountdown: 'Sold Out',
                    endsToday: false
                };
            } else {
                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                const countdownText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                
                if (countdownText !== product.deadlineCountdown) {
                    hasChanges = true;
                    return {
                        ...product,
                        deadlineCountdown: countdownText,
                        endsToday: diff < 24 * 3600000
                    };
                }
            }
            
            return product;
        });
        
        if (hasChanges) {
            this.setData({ filteredGroups: updated });
        }
    },

    // ================= TAB BAR SWITCH =================
    onTabSwitch(e) {
        const { page } = e.detail;
        const pages = {
            'home': '/pages/home/home',
            'travel': '/pages/travel/travel',
            'secondHand': '/pages/secondHand/secondHand',
            'community': '/pages/community/community',
            'profile': '/pages/profile/profile'
        };
        
        if (pages[page] && page !== 'index') {
            wx.switchTab({
                url: pages[page],
                fail: () => {
                    wx.navigateTo({ url: pages[page] });
                }
            });
        }
    },

    // ================= SEARCH =================
    expandSearch() { 
        this.setData({ isSearchExpanded: true }); 
    },
    
    collapseSearch() { 
        this.setData({ isSearchExpanded: false, searchKeyword: '' });
        this.loadProducts();
    },
    
    onSearchInput(e) { 
        this.setData({ searchKeyword: e.detail.value }); 
    },
    
    onSearch() { 
        this.filterProducts(); 
    },
    
    onSearchBlur() {
        if (!this.data.searchKeyword) {
            this.collapseSearch();
        }
    },
    
    clearSearch() { 
        this.setData({ searchKeyword: '' });
        this.loadProducts();
    },

    // ================= TAB SWITCHING =================
    switchTab(e) {
        this.setData({ activeTab: e.currentTarget.dataset.tab });
        this.filterProducts();
    },

    // ================= FILTER PRODUCTS =================
    async filterProducts() {
        let filtered = [...this.data.filteredGroups];
        
        if (this.data.searchKeyword) {
            const keyword = this.data.searchKeyword.toLowerCase();
            filtered = filtered.filter(p => 
                p.productName.toLowerCase().includes(keyword)
            );
        }
        
        const sortBy = this.data.activeTab;
        if (sortBy === 'popular') {
            filtered.sort((a, b) => (b.discount || 0) - (a.discount || 0));
        } else if (sortBy === 'new') {
            filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
        
        this.setData({ filteredGroups: filtered });
    },

    // ================= IMAGE HANDLING =================
    onImageError(e) {
        const { index } = e.currentTarget.dataset;
        if (index !== undefined) {
            this.setData({ [`filteredGroups[${index}].imageError`]: true });
        }
    },
    
    async chooseImage() {
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: async (res) => {
                if (res.tempFiles && res.tempFiles[0]) {
                    const tempFilePath = res.tempFiles[0].tempFilePath;
                    
                    wx.showLoading({ title: 'Uploading...' });
                    
                    try {
                        const timestamp = Date.now();
                        const random = Math.random().toString(36).substr(2, 6);
                        const cloudPath = `product-images/${timestamp}-${random}.jpg`;
                        
                        const uploadRes = await wx.cloud.uploadFile({
                            cloudPath: cloudPath,
                            filePath: tempFilePath
                        });
                        
                        this.setData({ 'productForm.productImage': uploadRes.fileID });
                        wx.hideLoading();
                        wx.showToast({ title: 'Uploaded', icon: 'success' });
                    } catch (err) {
                        wx.hideLoading();
                        wx.showToast({ title: 'Upload failed', icon: 'none' });
                    }
                }
            }
        });
    },

    // ================= CREATE/EDIT PRODUCT =================
    showCreateModal() {
        this.setData({
            showCreateModal: true,
            editingProduct: null,
            productForm: { 
                productName: '', 
                category: '', 
                categoryName: '', 
                description: '', 
                originalPrice: '', 
                groupPrice: '', 
                targetMembers: '', 
                productImage: '' 
            }
        });
    },
    
    hideCreateModal() { 
        this.setData({ showCreateModal: false }); 
    },
    
    async editProduct(e) {
        const id = e.currentTarget.dataset.id;
        const product = this.data.filteredGroups.find(p => p.id === id);
        if (product) {
            let productImage = '';
            try {
                const res = await db.collection('products').doc(id).get();
                if (res.data && res.data.productImage) {
                    productImage = res.data.productImage;
                }
            } catch (err) {
                productImage = product.productImage || '';
            }
            
            this.setData({
                showCreateModal: true,
                editingProduct: product,
                productForm: {
                    productName: product.productName || '',
                    category: product.category || '',
                    categoryName: product.categoryName || '',
                    description: product.description || '',
                    originalPrice: product.originalPrice || '',
                    groupPrice: product.groupPrice || '',
                    targetMembers: product.targetMembers || '',
                    productImage: productImage
                }
            });
        }
    },
    
    async deleteProduct(e) {
        const id = e.currentTarget.dataset.id;
        const res = await wx.showModal({
            title: 'Confirm Delete',
            content: 'Delete this product?'
        });
        
        if (res.confirm) {
            wx.showLoading({ title: 'Deleting...' });
            try {
                await db.collection('products').doc(id).remove();
                wx.showToast({ title: 'Deleted', icon: 'success' });
                this.loadProducts();
            } catch (err) {
                wx.showToast({ title: 'Delete failed', icon: 'none' });
            } finally {
                wx.hideLoading();
            }
        }
    },
    
    onProductInput(e) {
        const field = e.currentTarget.dataset.field;
        const value = e.detail.value;
        this.setData({ [`productForm.${field}`]: value });
    },
    
    onCategoryChange(e) {
        const index = e.detail.value;
        const cat = this.data.categoryNames[index];
        if (cat) {
            this.setData({ 
                'productForm.category': cat.toLowerCase(), 
                'productForm.categoryName': cat 
            });
        }
    },
    
    async saveProduct() {
        if (!this.data.productForm.productName) {
            wx.showToast({ title: 'Enter product name', icon: 'none' });
            return;
        }
        
        wx.showLoading({ title: 'Saving...' });
        
        try {
            const formData = this.data.productForm;
            const now = new Date();
            const deadline = new Date(now);
            deadline.setDate(deadline.getDate() + 1);
            deadline.setHours(17, 0, 0, 0);
            
            const dataToSave = {
                productName: formData.productName.trim(),
                category: formData.category || 'other',
                categoryName: formData.categoryName || '',
                description: formData.description || '',
                originalPrice: parseFloat(formData.originalPrice) || 0,
                groupPrice: parseFloat(formData.groupPrice) || 0,
                targetMembers: parseInt(formData.targetMembers) || 10,
                productImage: formData.productImage || '',
                status: 'active',
                updatedAt: db.serverDate(),
                deadline: deadline
            };
            
            if (this.data.editingProduct) {
                await db.collection('products').doc(this.data.editingProduct.id).update({
                    data: dataToSave
                });
                wx.showToast({ title: 'Updated!', icon: 'success' });
            } else {
                dataToSave.createdAt = db.serverDate();
                await db.collection('products').add({ data: dataToSave });
                wx.showToast({ title: 'Created!', icon: 'success' });
            }
            
            this.hideCreateModal();
            this.loadProducts();
        } catch (err) {
            wx.showToast({ title: 'Save failed', icon: 'none' });
        } finally {
            wx.hideLoading();
        }
    },

    // ================= PAYMENT =================
    hidePaymentModal() {
        this.setData({ 
            showPaymentModal: false, 
            payerName: '', 
            paidAmount: '', 
            transactionId: '',
            buyerQRCode: ''
        });
    },
    
    switchPaymentMethod(e) { 
        this.setData({ paymentMethod: e.currentTarget.dataset.method }); 
    },
    
    uploadBuyerQR() {
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            success: async (res) => {
                if (!res.tempFiles || !res.tempFiles[0]) return;
                
                const tempPath = res.tempFiles[0].tempFilePath;
                
                wx.showLoading({ title: 'Uploading...' });
                
                try {
                    const timestamp = Date.now();
                    const random = Math.random().toString(36).substr(2, 6);
                    const uploadRes = await wx.cloud.uploadFile({
                        cloudPath: `buyer-qr/${timestamp}-${random}.jpg`,
                        filePath: tempPath
                    });
                    this.setData({ buyerQRCode: uploadRes.fileID });
                    wx.hideLoading();
                    wx.showToast({ title: 'QR Uploaded', icon: 'success' });
                } catch (err) {
                    wx.hideLoading();
                    this.setData({ buyerQRCode: tempPath });
                    wx.showToast({ title: 'Saved locally', icon: 'success' });
                }
            }
        });
    },
    
    onPayerNameInput(e) { 
        this.setData({ payerName: e.detail.value }); 
    },
    
    onPaidAmountInput(e) { 
        this.setData({ paidAmount: e.detail.value }); 
    },
    
    onTransactionIdInput(e) { 
        this.setData({ transactionId: e.detail.value }); 
    },
    
    async confirmPayment() {
        if (!this.data.payerName || !this.data.paidAmount) {
            wx.showToast({ title: 'Fill required fields', icon: 'none' });
            return;
        }
        
        if (this.data.selectedGroup.isExpired) {
            wx.showToast({ title: 'Product is sold out!', icon: 'none' });
            return;
        }
        
        wx.showLoading({ title: 'Processing...' });
        
        try {
            await db.collection('orders').add({
                data: {
                    productId: this.data.selectedGroup.id,
                    productName: this.data.selectedGroup.productName,
                    payerName: this.data.payerName,
                    paidAmount: parseFloat(this.data.paidAmount),
                    transactionId: this.data.transactionId,
                    buyerQRCode: this.data.buyerQRCode,
                    paymentMethod: this.data.paymentMethod,
                    status: 'pending',
                    createdAt: db.serverDate()
                }
            });
            
            wx.showToast({ title: 'Payment submitted!', icon: 'success' });
            this.hidePaymentModal();
        } catch (err) {
            wx.showToast({ title: 'Failed to submit', icon: 'none' });
        } finally {
            wx.hideLoading();
        }
    },

    // ================= QR ERROR HANDLERS =================
    onWechatQRError() {
        console.error('WeChat QR image failed to load');
        wx.showToast({ title: 'WeChat QR failed to load', icon: 'none' });
    },
    
    onAlipayQRError() {
        console.error('Alipay QR image failed to load');
        wx.showToast({ title: 'Alipay QR failed to load', icon: 'none' });
    },

    // ================= DESCRIPTION =================
    showDescModal(e) {
        const id = e.currentTarget.dataset.id;
        const product = this.data.filteredGroups.find(p => p.id === id);
        if (product) {
            this.setData({ showDescModal: true, descProduct: product });
        }
    },
    
    hideDescModal() { 
        this.setData({ showDescModal: false }); 
    },
    
    buyFromDesc() {
        const product = this.data.descProduct;
        if (product.isExpired) {
            wx.showToast({ title: 'Product is sold out!', icon: 'none' });
            return;
        }
        this.setData({ 
            showDescModal: false, 
            showPaymentModal: true, 
            selectedGroup: product,
            paidAmount: product.groupPrice || ''
        });
        this.loadAdminQRCodes();
    },

    // ================= UTILS =================
    stopPropagation() {},
    
    onRefresh() { 
        this.loadProducts().then(() => {
            wx.stopPullDownRefresh();
        }).catch(() => {
            wx.stopPullDownRefresh();
        });
    },
    
    startCountdown() {
        const updateCountdown = () => {
            const now = new Date();
            const target = new Date();
            target.setHours(17, 0, 0, 0);
            if (target <= now) target.setDate(target.getDate() + 1);
            
            const diff = target - now;
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            
            this.setData({ globalCountdown: `${h}:${m}:${s}` });
        };
        
        updateCountdown();
        this.countdownInterval = setInterval(updateCountdown, 1000);
    },

    // In your joinGroup function - move loadAdminQRCodes BEFORE showing modal
joinGroup(e) {
    const id = e.currentTarget.dataset.id;
    const product = this.data.filteredGroups.find(p => p.id === id);
    if (product) {
        if (product.isExpired) {
            wx.showToast({ title: 'Product is sold out!', icon: 'none' });
            return;
        }
        
        // Load QR codes FIRST, then show modal
        this.loadAdminQRCodes().then(() => {
            this.setData({ 
                showPaymentModal: true, 
                selectedGroup: product,
                paidAmount: product.groupPrice || '',
                buyerQRCode: '',
                payerName: '',
                transactionId: ''
            });
        });
    }
}
});