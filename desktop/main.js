const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#080b16', title: 'izzi TV Pocoyito', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
