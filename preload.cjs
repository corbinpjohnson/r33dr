const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  summarizeChapter: (text, chapterTitle) => ipcRenderer.invoke('summarize-chapter', { text, chapterTitle }),
  readNotes: (notesPath) => ipcRenderer.invoke('read-notes', notesPath),
  writeNotes: (notesPath, content) => ipcRenderer.invoke('write-notes', { notesPath, content }),
  getPathForFile: (file) => webUtils.getPathForFile(file),
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('r33dr Preload Initialized');
});
