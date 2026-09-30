const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('schoolBackup', {
  exportBackup: (token) => ipcRenderer.invoke('school-backup:export', token),
  restoreBackup: (token) => ipcRenderer.invoke('school-backup:restore', token),
  chooseBackupFolder: (token) => ipcRenderer.invoke('school-backup:choose-folder', token),
  getBackupStatus: (token) => ipcRenderer.invoke('school-backup:status', token),
  getCloudStatus: (token) => ipcRenderer.invoke('school-cloud:status', token),
  syncCloud: (token) => ipcRenderer.invoke('school-cloud:sync', token),
  applyCloud: (token) => ipcRenderer.invoke('school-cloud:apply', token),
  publishCloud: (token) => ipcRenderer.invoke('school-cloud:publish', token),
});