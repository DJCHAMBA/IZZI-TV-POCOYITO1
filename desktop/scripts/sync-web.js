const fs = require('fs');
const path = require('path');
const desktopDir = path.resolve(__dirname, '..');
const projectDir = path.resolve(desktopDir, '..');
const webDir = path.join(desktopDir, 'web');
fs.mkdirSync(path.join(webDir, 'icons'), { recursive: true });
for (const file of ['index.html','manifest.webmanifest','service-worker.js']) {
  fs.copyFileSync(path.join(projectDir, file), path.join(webDir, file));
}
fs.copyFileSync(path.join(projectDir, 'icons', 'icon.svg'), path.join(webDir, 'icons', 'icon.svg'));
console.log('Shared web app synchronized into desktop/web.');
