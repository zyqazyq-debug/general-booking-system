const fs = require('fs');
const path = require('path');

const historyDir = 'C:\\Users\\realzyq\\AppData\\Roaming\\trae\\User\\History';
const targetDir = 'D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src';

function restoreAllSmallFiles() {
    const historyFolders = fs.readdirSync(historyDir);
    const basenameToHistory = new Map();

    for (const folder of historyFolders) {
        const folderPath = path.join(historyDir, folder);
        const entriesPath = path.join(folderPath, 'entries.json');
        if (fs.existsSync(entriesPath)) {
            try {
                const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
                if (entriesData && entriesData.resource && entriesData.resource.includes('frontend/src')) {
                    let decoded = decodeURIComponent(entriesData.resource.replace('file:///', '').replace('file://', ''));
                    const basename = path.basename(decoded).toLowerCase();
                    
                    const entries = entriesData.entries;
                    if (entries && entries.length > 0) {
                        const latestEntry = entries[entries.length - 1];
                        const latestFilePath = path.join(folderPath, latestEntry.id);
                        if (fs.existsSync(latestFilePath)) {
                            const content = fs.readFileSync(latestFilePath, 'utf-8');
                            if (content.length > 30) {
                                if (!basenameToHistory.has(basename)) {
                                    basenameToHistory.set(basename, []);
                                }
                                basenameToHistory.get(basename).push({
                                    file: latestFilePath,
                                    timestamp: latestEntry.timestamp,
                                    content: content
                                });
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    }

    function walkDir(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                walkDir(fullPath);
            } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.vue')) {
                const stat = fs.statSync(fullPath);
                if (stat.size < 30) {
                    const basename = path.basename(fullPath).toLowerCase();
                    const candidates = basenameToHistory.get(basename) || [];
                    if (candidates.length > 0) {
                        candidates.sort((a, b) => b.timestamp - a.timestamp);
                        fs.writeFileSync(fullPath, candidates[0].content, 'utf-8');
                        console.log('Restored from history:', fullPath);
                    } else {
                        console.log('COULD NOT FIND HISTORY FOR:', fullPath);
                    }
                }
            }
        }
    }

    walkDir(targetDir);
}

restoreAllSmallFiles();
console.log('Done restoring small files.');
