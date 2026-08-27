//執行指令：node convert.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const targetDir = path.join(__dirname, 'tiles');

function findPngFiles(directory) {
    const pngFiles = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            pngFiles.push(...findPngFiles(entryPath));
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.png') {
            pngFiles.push(entryPath);
        }
    }

    return pngFiles;
}

async function convertPngToWebp() {
    try {
        const pngFiles = findPngFiles(targetDir);

        if (pngFiles.length === 0) {
            console.log('❌ tiles 資料夾及其子資料夾內找不到任何 PNG 檔案！');
            return;
        }

        console.log(`📦 發現 ${pngFiles.length} 個 PNG 檔案，開始無損轉換...`);

        for (const pngPath of pngFiles) {
            const baseName = path.basename(pngPath, path.extname(pngPath));
            const webpPath = path.join(path.dirname(pngPath), `${baseName}.webp`);

            console.log(`⏳ 正在轉換: ${path.relative(targetDir, pngPath)} -> ${path.relative(targetDir, webpPath)}`);

            // 使用 sharp 進行無損 WebP 轉換
            await sharp(pngPath)
                .webp({ lossless: true })
                .toFile(webpPath);

            // 轉檔成功後刪除原檔
            fs.unlinkSync(pngPath);
            console.log(`✅ 已完成並刪除原 PNG: ${path.relative(targetDir, pngPath)}`);
        }

        console.log('\n🎉 所有 PNG 檔案已無損轉換為 WebP 並清理完畢！');

    } catch (error) {
        console.error('❌ 轉檔過程發生錯誤:', error.message);
    }
}

// 執行轉檔作業
convertPngToWebp();