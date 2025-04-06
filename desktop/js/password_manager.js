/**
 * 密碼管理模塊 - 處理用戶密碼的存儲和驗證
 */
const PasswordManager = (function() {
    // 密碼存儲鍵名
    const PASSWORD_STORAGE_KEY = 'urDiary_user_passwords';
    
    // 初始化默認密碼
    function initDefaultPasswords() {
        const savedPasswords = getPasswords();
        
        // 如果沒有保存的密碼，設置默認密碼
        if (Object.keys(savedPasswords).length === 0) {
            const defaultPasswords = {
                '1': '1111',
                '2': '2222',
                '3': '3333',
                '4': '4444'
            };
            
            // 保存默認密碼
            savePasswords(defaultPasswords);
            console.log('已初始化默認密碼');
        }
    }
    
    // 獲取所有密碼
    function getPasswords() {
        try {
            const passwordsJSON = localStorage.getItem(PASSWORD_STORAGE_KEY);
            return passwordsJSON ? JSON.parse(passwordsJSON) : {};
        } catch (error) {
            console.error('獲取密碼時出錯:', error);
            return {};
        }
    }
    
    // 保存所有密碼
    function savePasswords(passwords) {
        try {
            localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(passwords));
            return true;
        } catch (error) {
            console.error('保存密碼時出錯:', error);
            return false;
        }
    }
    
    // 驗證用戶密碼
    function verifyPassword(userId, password) {
        const passwords = getPasswords();
        return passwords[userId] === password;
    }
    
    // 設置用戶密碼
    function setPassword(userId, password) {
        try {
            // 獲取現有密碼
            const passwords = getPasswords();
            
            // 更新密碼
            passwords[userId] = password;
            
            // 保存密碼
            return savePasswords(passwords);
        } catch (error) {
            console.error('設置密碼時出錯:', error);
            return false;
        }
    }
    
    // 驗證密碼格式
    function validatePassword(password) {
        // 檢查密碼長度
        if (password.length < 4 || password.length > 20) {
            return {
                valid: false,
                message: '密碼長度必須在4-20位之間'
            };
        }
        
        // 密碼其他規則可以在這裡添加
        
        return {
            valid: true,
            message: ''
        };
    }
    
    // 初始化密碼管理器
    function init() {
        console.log('初始化密碼管理器');
        
        // 初始化默認密碼
        initDefaultPasswords();
        
        return true;
    }
    
    // 公開API
    return {
        init: init,
        verifyPassword: verifyPassword,
        setPassword: setPassword,
        validatePassword: validatePassword,
        getPasswords: getPasswords
    };
})();

// 將密碼管理器暴露為全局變量
window.PasswordManager = PasswordManager; 