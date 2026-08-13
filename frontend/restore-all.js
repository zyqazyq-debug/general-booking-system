const fs = require('fs');
const path = require('path');

const historyDir = 'C:\\Users\\realzyq\\AppData\\Roaming\\trae\\User\\History';
const targetDir = 'D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src';

function restoreAllFromHistory() {
    const historyFolders = fs.readdirSync(historyDir);
    const fileToHistory = new Map();

    for (const folder of historyFolders) {
        const folderPath = path.join(historyDir, folder);
        const entriesPath = path.join(folderPath, 'entries.json');
        if (fs.existsSync(entriesPath)) {
            try {
                const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
                if (entriesData && entriesData.resource && entriesData.resource.includes('frontend/src')) {
                    let decoded = decodeURIComponent(entriesData.resource.replace('file:///', '').replace('file://', ''));
                    decoded = decoded.replace(/\//g, '\\').toLowerCase();
                    
                    const entries = entriesData.entries;
                    if (entries && entries.length > 0) {
                        const latestEntry = entries[entries.length - 1];
                        const latestFilePath = path.join(folderPath, latestEntry.id);
                        if (fs.existsSync(latestFilePath)) {
                            if (!fileToHistory.has(decoded) || fileToHistory.get(decoded).timestamp < latestEntry.timestamp) {
                                fileToHistory.set(decoded, {
                                    file: latestFilePath,
                                    timestamp: latestEntry.timestamp
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
                const lowerPath = fullPath.toLowerCase();
                // Find best match in history (case-insensitive)
                let bestMatch = null;
                for (const [key, val] of fileToHistory.entries()) {
                    if (key.endsWith(lowerPath.substring(3))) {
                        bestMatch = val;
                        break;
                    }
                }

                if (bestMatch) {
                    const content = fs.readFileSync(bestMatch.file, 'utf-8');
                    // Check if the history file is not the corrupted one (length < 10)
                    if (content.length > 10) {
                        fs.writeFileSync(fullPath, content, 'utf-8');
                        // console.log('Restored latest:', fullPath);
                    }
                }
            }
        }
    }

    walkDir(targetDir);
}

restoreAllFromHistory();
console.log('Restored all from history.');
