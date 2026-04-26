// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const safeString = (val, maxLen = 80) => {
  if (!val || typeof val !== 'string') return ''
  return val.trim().slice(0, maxLen)
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { userInfo = {} } = event || {}
  const nickName = safeString(userInfo.nickName, 60)
  const avatarUrl = safeString(userInfo.avatarUrl, 600)
  const gender = Number(userInfo.gender) || 0
  const country = safeString(userInfo.country, 60)
  const province = safeString(userInfo.province, 60)
  const city = safeString(userInfo.city, 60)
  const language = safeString(userInfo.language, 20)
  
  try {
    const userRecord = await db.collection('users').where({
      openId: wxContext.OPENID
    }).get()
    
    if (userRecord.data.length === 0) {
      const createResult = await db.collection('users').add({
        data: {
          openId: wxContext.OPENID,
          unionId: wxContext.UNIONID || '',
          nickName: nickName || 'New User',
          avatarUrl,
          gender,
          country,
          province,
          city,
          language,
          createTime: db.serverDate(),
          lastLogin: db.serverDate()
        }
      })

      const created = await db.collection('users').doc(createResult._id).get()
      return {
        success: true,
        isNewUser: true,
        openid: wxContext.OPENID,
        unionid: wxContext.UNIONID,
        user: created.data
      }
    } else {
      const existingUser = userRecord.data[0]
      await db.collection('users').doc(existingUser._id).update({
        data: {
          lastLogin: db.serverDate(),
          nickName: nickName || existingUser.nickName,
          avatarUrl: avatarUrl || existingUser.avatarUrl
        }
      })

      const updated = await db.collection('users').doc(existingUser._id).get()
      return {
        success: true,
        isNewUser: false,
        openid: wxContext.OPENID,
        unionid: wxContext.UNIONID,
        user: updated.data
      }
    }
  } catch (err) {
    console.error('login cloud function failed:', err)
    return {
      success: false,
      errorMessage: err && err.message ? err.message : 'Internal server error'
    }
  }
}