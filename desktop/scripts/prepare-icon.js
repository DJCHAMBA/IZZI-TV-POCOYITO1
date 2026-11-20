const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');
(async()=>{
 const root=path.resolve(__dirname,'../..');
 const svg=fs.readFileSync(path.join(root,'desktop/icons/pocoyito-app.svg'));
 const png=await sharp(svg).resize(256,256).png().toBuffer();
 const ico=await pngToIco(png);
 fs.writeFileSync(path.join(root,'desktop/icons/pocoyito.ico'),ico);
 console.log('Icono Pocoyito TV generado:',ico.length,'bytes');
})().catch(e=>{console.error(e);process.exit(1);});
