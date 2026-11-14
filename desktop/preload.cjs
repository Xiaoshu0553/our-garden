const { contextBridge, ipcRenderer } = require('electron');
async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) { const error = new Error(result.message); error.status = result.status; error.offline = result.offline; throw error; }
  return result.data;
}
contextBridge.exposeInMainWorld('gardenDesktop', {
  info: () => call('garden:info'),
  openGuide: () => call('garden:help'),
  update: action => call('garden:update', action),
  request: (path, method, body) => call('garden:request', path, method, body),
  settings: value => call('garden:settings', value),
  configure: value => call('garden:configure', value),
  identity: id => call('garden:identity', id),
  openPeer: () => call('garden:peer'),
  hidePanel: () => ipcRenderer.send('garden:hide'),
  openGarden: id => call('garden:open', id),
  petReady: () => call('garden:pet-ready'),
  petHit: value => ipcRenderer.send('garden:pet-hit', value),
  movePet: (x, y) => ipcRenderer.send('garden:move', x, y),
  togglePanel: () => ipcRenderer.send('garden:toggle'),
  openMain: id => ipcRenderer.send('garden:main', id),
  resizeQuick: height => ipcRenderer.send('garden:quick-size', height),
  petMenu: () => ipcRenderer.send('garden:menu'),
  onEvent: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('garden:event', listener);
    return () => ipcRenderer.removeListener('garden:event', listener);
  },
});
