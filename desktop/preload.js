const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('pocoyitoDesktop', { platform: process.platform });
