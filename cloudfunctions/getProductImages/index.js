const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { productIds } = event;
  
  try {
    // Get products from database (cloud function has full access)
    const productsRes = await db.collection('products')
      .where({
        _id: db.command.in(productIds),
        status: 'active'
      })
      .get();
    
    const products = productsRes.data;
    
    // Collect cloud file IDs
    const cloudFileIds = [];
    products.forEach(p => {
      if (p.productImage && p.productImage.startsWith('cloud://')) {
        cloudFileIds.push(p.productImage);
      }
    });
    
    // Generate temp URLs with admin privilege
    let tempUrlMap = {};
    if (cloudFileIds.length > 0) {
      const tempRes = await cloud.getTempFileURL({
        fileList: cloudFileIds,
        // Set longer expiration for better UX
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });
      
      tempRes.fileList.forEach(file => {
        if (file.status === 0 && file.tempFileURL) {
          tempUrlMap[file.fileID] = file.tempFileURL;
        }
      });
    }
    
    // Attach temp URLs to products
    const processedProducts = products.map(p => ({
      ...p,
      id: p._id,
      productImage: tempUrlMap[p.productImage] || p.productImage || '',
      imageError: !tempUrlMap[p.productImage] && p.productImage?.startsWith('cloud://')
    }));
    
    return {
      success: true,
      products: processedProducts
    };
    
  } catch (err) {
    console.error('Cloud function error:', err);
    return {
      success: false,
      error: err.message
    };
  }
};