const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 保持對窗口對象的全局引用，避免垃圾回收時窗口被關閉
let mainWindow;

// 設定檔案路徑
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

// 確保資源目錄存在
function ensureResourceDirectories() {
  try {
    const directories = [
      path.join(__dirname, 'assets'),
      path.join(__dirname, 'assets/images'),
      path.join(__dirname, 'logs')
    ];
    
    // 檢查並創建每個目錄
    directories.forEach(dir => {
      if (!fs.existsSync(dir)) {
        console.log(`創建目錄: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // 確保默認頭像圖片存在
    const defaultAvatarPath = path.join(__dirname, 'assets/images/default-avatar.png');
    if (!fs.existsSync(defaultAvatarPath)) {
      // 這裡可以復制一個默認圖片或創建一個空白圖片
      console.log(`默認頭像不存在，創建空文件: ${defaultAvatarPath}`);
      fs.writeFileSync(defaultAvatarPath, '');
    }
    
    const robotAvatarPath = path.join(__dirname, 'assets/images/robot-avatar.svg');
    if (!fs.existsSync(robotAvatarPath)) {
      console.log(`機器人頭像不存在，創建空文件: ${robotAvatarPath}`);
      fs.writeFileSync(robotAvatarPath, '');
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
      baseUrl: 'http://localhost:8000',
      timeout: 30000
    },
    useMockData: true
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
  
  // 創建瀏覽器窗口
  mainWindow = new BrowserWindow({
    width: config.windowWidth || 1200,
    height: config.windowHeight || 800,
    minWidth: 800,
    minHeight: 600,
    title: 'URDiary',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: true,
      autoplayPolicy: 'user-gesture-required',
      // 禁用Autofill功能，避免相關錯誤
      enableBlinkFeatures: '',
      disableBlinkFeatures: 'Autofill'
    }
  });

  // 設置內容安全策略
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com;"
        ]
      }
    });
  });

  // 載入應用的 index.html
  mainWindow.loadFile('index.html');

  // 打開開發者工具 - 始终開啟，無需開發模式限制
  mainWindow.webContents.openDevTools();

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

// 在主進程中添加自定義功能
ipcMain.on('show-error-dialog', (event, message) => {
  dialog.showErrorBox('錯誤', message);
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

// 顯示信息對話框
ipcMain.handle('show-message-dialog', async (event, options) => {
  return await dialog.showMessageBox(options);
});

// 選擇文件對話框
ipcMain.handle('show-open-dialog', async (event, options) => {
  return await dialog.showOpenDialog(options);
});

// 保存文件對話框
ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(options);
});

// 獲取配置
ipcMain.handle('get-config', async () => {
  return loadConfig();
});

// 保存配置
ipcMain.on('save-config', (event, config) => {
  saveConfig(config);
});

// 打開外部連結
ipcMain.on('open-external-link', (event, url) => {
  shell.openExternal(url);
});

// 檢查後端服務是否可用
ipcMain.handle('check-backend-service', async () => {
  try {
    const response = await fetch('http://localhost:8000');
    return response.ok;
  } catch (error) {
    console.warn('後端服務不可用:', error.message);
    return false;
  }
});

// 獲取錯誤日誌文件列表
ipcMain.handle('get-error-log-files', async () => {
  try {
    const errorLogsDir = path.join(userDataPath, 'error_logs');
    
    // 確保目錄存在
    if (!fs.existsSync(errorLogsDir)) {
      fs.mkdirSync(errorLogsDir, { recursive: true });
      return [];
    }
    
    // 讀取目錄中的所有日誌文件
    const files = fs.readdirSync(errorLogsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(errorLogsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          mtime: stats.mtime
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // 按修改時間降序排序
    
    return files;
  } catch (error) {
    console.error('獲取錯誤日誌文件列表失敗:', error);
    return [];
  }
});

// 讀取錯誤日誌文件內容
ipcMain.handle('read-error-log-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return '文件不存在';
  } catch (error) {
    console.error('讀取錯誤日誌文件失敗:', error);
    return `讀取錯誤: ${error.message}`;
  }
});

// 打開錯誤日誌所在目錄
ipcMain.on('open-error-logs-directory', (event) => {
  const errorLogsDir = path.join(userDataPath, 'error_logs');
  
  // 確保目錄存在
  if (!fs.existsSync(errorLogsDir)) {
    fs.mkdirSync(errorLogsDir, { recursive: true });
  }
  
  // 打開目錄
  shell.openPath(errorLogsDir);
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