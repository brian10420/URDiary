// 預加載腳本在渲染進程加載之前運行
// 它可以訪問 Node.js API 並定義在渲染進程中可用的全局變量

const { ipcRenderer, contextBridge } = require('electron');
const path = require('path');
const fs = require('fs');

// 創建一個安全的通信通道
contextBridge.exposeInMainWorld('electronAPI', {
  // 對話框相關
  showErrorDialog: (message) => ipcRenderer.send('show-error-dialog', message),
  showMessageDialog: (options) => ipcRenderer.invoke('show-message-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  
  // 配置相關
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.send('save-config', config),
  
  // 系統相關
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
  checkBackendService: () => ipcRenderer.invoke('check-backend-service'),
  
  // 錯誤日誌相關
  saveErrorLog: (errorInfo) => ipcRenderer.send('save-error-log', errorInfo),
  getErrorLogFiles: () => ipcRenderer.invoke('get-error-log-files'),
  readErrorLogFile: (filePath) => ipcRenderer.invoke('read-error-log-file', filePath),
  openErrorLogsDirectory: () => ipcRenderer.send('open-error-logs-directory'),
  
  // 文件系統相關
  readFile: (filePath, options = {}) => {
    try {
      return fs.readFileSync(filePath, options);
    } catch (error) {
      console.error(`讀取文件錯誤: ${filePath}`, error);
      throw error;
    }
  },
  writeFile: (filePath, data, options = {}) => {
    try {
      fs.writeFileSync(filePath, data, options);
      return true;
    } catch (error) {
      console.error(`寫入文件錯誤: ${filePath}`, error);
      throw error;
    }
  },
  existsSync: (filePath) => fs.existsSync(filePath),
  mkdirSync: (dirPath, options = {}) => {
    try {
      fs.mkdirSync(dirPath, options);
      return true;
    } catch (error) {
      console.error(`創建目錄錯誤: ${dirPath}`, error);
      throw error;
    }
  }
});

// 為渲染進程提供環境信息
contextBridge.exposeInMainWorld('appInfo', {
  appVersion: process.env.npm_package_version || '1.0.0',
  isDevelopment: process.env.NODE_ENV === 'development',
  platform: process.platform
});

// 向渲染進程添加更好的錯誤處理
window.addEventListener('error', (event) => {
  console.error('捕獲到未處理的錯誤:', event.error);
  // 將錯誤信息發送到主進程
  ipcRenderer.send('app-error', {
    message: event.error.message,
    stack: event.error.stack
  });
});

// 設置全局未捕獲的 Promise 錯誤處理器
window.addEventListener('unhandledrejection', (event) => {
  console.error('未處理的 Promise 拒絕:', event.reason);
  // 將錯誤信息發送到主進程
  ipcRenderer.send('app-error', {
    message: event.reason.message || '未知 Promise 錯誤',
    stack: event.reason.stack || ''
  });
});

// 當頁面加載完成時的處理
window.addEventListener('DOMContentLoaded', () => {
  console.log('應用已加載');
  
  // 動態載入主應用模塊
  const scriptTags = [
    'js/config.js',
    'js/api_service.js',
    'js/ui_manager.js',
    'js/chat_module.js',
    'js/diary_module.js',
    'js/notes_module.js',
    'js/app.js'  // 主應用模塊最後載入
  ];
  
  // 依序載入腳本
  let loadedCount = 0;
  scriptTags.forEach(src => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      loadedCount++;
      if (loadedCount === scriptTags.length) {
        // 所有腳本載入完成後，發送初始化事件
        document.dispatchEvent(new CustomEvent('app-modules-loaded'));
      }
    };
    script.onerror = (error) => {
      console.error(`載入腳本錯誤: ${src}`, error);
      ipcRenderer.send('show-error-dialog', `無法載入應用模塊: ${src}`);
    };
    document.body.appendChild(script);
  });
  
  // 檢查後端服務
  ipcRenderer.invoke('check-backend-service')
    .then(isAvailable => {
      if (isAvailable) {
        console.log('後端服務可用');
        document.dispatchEvent(new CustomEvent('backend-available'));
      } else {
        console.warn('後端服務不可用，請確保 API 服務已啟動');
        document.dispatchEvent(new CustomEvent('backend-unavailable'));
      }
    });
});