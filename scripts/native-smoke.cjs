/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require('electron');
const pty = require('node-pty');
let child;
const timeout = setTimeout(() => {
  child?.kill();
  app.exit(1);
}, 20000);
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await window.loadURL('data:text/html,<title>native smoke</title>');
    if ((await window.webContents.executeJavaScript('document.title')) !== 'native smoke')
      throw new Error('Renderer failed');
    child = pty.spawn(
      process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'echo MOFOX_NATIVE_OK']
        : ['-c', 'echo MOFOX_NATIVE_OK'],
      { cols: 80, rows: 24, cwd: process.cwd(), env: process.env },
    );
    let output = '';
    child.onData((data) => {
      output += data;
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      app.exit(exitCode === 0 && output.includes('MOFOX_NATIVE_OK') ? 0 : 1);
    });
  })
  .catch(() => {
    clearTimeout(timeout);
    child?.kill();
    app.exit(1);
  });
