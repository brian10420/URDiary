const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
// 引入@electron/remote模塊
const remoteMain = require('@electron/remote/main');

// 保持對窗口對象的全局引用，避免垃圾回收時窗口被關閉
let mainWindow;

// 設定檔案路徑
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

// 確保資源目錄存在（僅 logs——assets 下的圖檔隨版控存在，不再由主行程補建空檔）
function ensureResourceDirectories() {
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      console.log(`創建目錄: ${logsDir}`);
      fs.mkdirSync(logsDir, { recursive: true });
    }

    console.log('資源目錄檢查完成');
    return true;
  } catch (error) {
    console.error('檢查資源目錄時出錯:', error);
    return false;
  }
}

// 加載配置
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    console.error('加載配置錯誤:', error);
  }
  return {
    windowWidth: 1200,
    windowHeight: 800,
    theme: 'light',
    api: {
      baseUrl: 'http://localhost:8001',
      timeout: 30000
    },
    useMockData: false
  }; // 返回默認配置
}

// 保存配置
function saveConfig(config) {
  try {
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('保存配置錯誤:', error);
  }
}

function createWindow() {
  const config = loadConfig();
  
  // 確保資源目錄存在
  ensureResourceDirectories();
  
  console.log('創建應用程序窗口');
  
  // 創建瀏覽器窗口
  mainWindow = new BrowserWindow({
    width: config.windowWidth || 1200,
    height: config.windowHeight || 800,
    minWidth: 800,
    minHeight: 600,
    title: 'URDiary',
    icon: path.join(__dirname, 'assets/icon.jpg'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true, // 啟用remote模塊支持
      webSecurity: true,
      autoplayPolicy: 'user-gesture-required',
      // 禁用Autofill功能，避免相關錯誤
      enableBlinkFeatures: '',
      disableBlinkFeatures: 'Autofill'
    }
  });
  
  // 初始化@electron/remote
  remoteMain.initialize();
  remoteMain.enable(mainWindow.webContents);

  // 設置內容安全策略
  //
  // style-src/font-src 曾經對 Google Fonts / cdnjs 開放，是因為 index.html
  // 當時直接外連這兩個 CDN 載入 Noto Sans TC 與 Font Awesome。v2.3 task 2.2
  // 已把兩者都改成自架 (desktop/assets/vendor/)，index.html 不再有任何外部
  // 主機的 <link>，這裡的外部主機例外因此一併移除——跟後端
  // middleware/security_headers.py 的嚴格 CSP 打齊，兩邊都不再容忍任何外部
  // 主機（'self' 已經涵蓋 file:// 底下同目錄的自架字型/圖示）。
  //
  // media-src 額外開放 blob:（v2.4 spec② 語音）：TTS 用 new Audio(
  // URL.createObjectURL(blob)) 播放 /voice/tts 回傳的 mp3 bytes，沒有這條
  // 例外會退回 default-src 'self'，blob: URL 播不出來；同樣跟後端那份 CSP
  // 打齊，不放寬任何外部主機。
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:;"
        ]
      }
    });
  });

  // 載入應用的 index.html
  mainWindow.loadFile('index.html');

  // 打開開發者工具 - 只在開發模式下打開
  // 可以通過設置環境變量或配置來控制
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (isDevelopment) {
    mainWindow.webContents.openDevTools();
    console.log('開發模式: 自動打開開發者工具');
  }

  // 設置窗口標題
  mainWindow.setTitle('URDiary - 您的情緒日記助手');

  // 保存窗口大小和位置
  mainWindow.on('close', () => {
    const { width, height } = mainWindow.getBounds();
    const config = loadConfig();
    config.windowWidth = width;
    config.windowHeight = height;
    saveConfig(config);
  });

  // 當窗口關閉時觸發的事件
  mainWindow.on('closed', function () {
    // 取消引用窗口對象
    mainWindow = null;
  });

  // 返回窗口對象
  return mainWindow;
}

// 當 Electron 完成初始化並準備建立瀏覽器窗口時調用此方法
app.whenReady().then(() => {
  // 解決控制台亂碼問題
  try {
    // 使用環境變量設置編碼
    process.env.LANG = 'zh_TW.UTF-8';
    
    // 記錄啟動信息
    console.log('==========================================');
    console.log('應用程序啟動成功 - URDiary');
    console.log('==========================================');
  } catch (error) {
    console.error('設置編碼時出錯:', error);
  }
  
  createWindow();

  app.on('activate', function () {
    // 在 macOS 上點擊 dock 圖標時沒有已開啟的窗口，則重新創建窗口
    if (mainWindow === null) {
      createWindow();
    }
  });
});

// 當所有窗口都被關閉時退出應用
app.on('window-all-closed', function () {
  // 在 macOS 上保持應用和菜單欄處於活動狀態，除非用戶使用 Cmd + Q 顯式退出
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 保存錯誤日誌到文件
ipcMain.on('save-error-log', (event, errorInfo) => {
  try {
    const errorLogsDir = path.join(userDataPath, 'error_logs');
    
    // 確保日誌目錄存在
    if (!fs.existsSync(errorLogsDir)) {
      fs.mkdirSync(errorLogsDir, { recursive: true });
    }
    
    // 生成日誌文件名（按日期）
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const logFilePath = path.join(errorLogsDir, `errors_${dateStr}.log`);
    
    // 將錯誤信息格式化為易讀的文本
    const timestamp = new Date(errorInfo.timestamp || date).toLocaleString();
    let logText = `[${timestamp}] ${errorInfo.type || '錯誤'}: ${errorInfo.message}\n`;
    
    if (errorInfo.filename) {
      logText += `文件: ${errorInfo.filename}`;
      if (errorInfo.lineno) {
        logText += ` (行: ${errorInfo.lineno}, 列: ${errorInfo.colno || 'N/A'})\n`;
      } else {
        logText += '\n';
      }
    }
    
    if (errorInfo.stack) {
      logText += `堆棧: ${errorInfo.stack}\n`;
    }
    
    logText += '------------------------\n';
    
    // 追加到日誌文件
    fs.appendFileSync(logFilePath, logText);
    
    console.log(`錯誤已記錄到: ${logFilePath}`);
  } catch (e) {
    console.error('保存錯誤日誌失敗:', e);
  }
});

// ---- LLM 供應商金鑰安全儲存 ----
// 以 Electron safeStorage (OS 金鑰鏈) 加密整包金鑰 JSON，存於 userData/provider-keys.enc。
// 金鑰絕不進 localStorage、不寫伺服器 DB；renderer 經 IPC 取得解密後的值放記憶體使用。
const providerKeysPath = path.join(userDataPath, 'provider-keys.enc');

function readProviderKeys() {
  try {
    if (!fs.existsSync(providerKeysPath)) {
      return {};
    }
    const encrypted = fs.readFileSync(providerKeysPath);
    if (!encrypted.length) {
      return {};
    }
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch (error) {
    console.error('讀取供應商金鑰失敗:', error);
    return {};
  }
}

function writeProviderKeys(keys) {
  if (!safeStorage.isEncryptionAvailable()) {
    // 沒有可用的 OS 金鑰鏈時絕不落地明文
    throw new Error('系統加密不可用 (safeStorage)，無法安全儲存金鑰');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(keys));
  fs.writeFileSync(providerKeysPath, encrypted);
}

// 設定/更新某個供應商的金鑰；value 為空字串等同刪除
ipcMain.handle('secure-store-set', async (event, provider, value) => {
  const keys = readProviderKeys();
  if (value) {
    keys[provider] = value;
  } else {
    delete keys[provider];
  }
  writeProviderKeys(keys);
  return true;
});

// 取回全部解密後的金鑰（renderer 啟動時載入一次，之後留在記憶體）
ipcMain.handle('secure-store-get', async () => {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage 加密不可用，回傳空金鑰集合');
    return {};
  }
  return readProviderKeys();
});

// 打開開發者工具
ipcMain.on('open-dev-tools', (event) => {
    try {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
            win.webContents.openDevTools();
            console.log('已通過 IPC 打開開發者工具');
        }
    } catch (error) {
        console.error('打開開發者工具失敗:', error);
    }
});