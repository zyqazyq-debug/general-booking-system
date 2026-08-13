const fs = require('fs');
const path = require('path');

const historyDir = 'C:\\Users\\realzyq\\AppData\\Roaming\\trae\\User\\History';
const targetDir = 'D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src';

function restoreFiles() {
    const historyFolders = fs.readdirSync(historyDir);
    const fileToHistory = new Map();

    // Map all history entries
    for (const folder of historyFolders) {
        const folderPath = path.join(historyDir, folder);
        const entriesPath = path.join(folderPath, 'entries.json');
        if (fs.existsSync(entriesPath)) {
            try {
                const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
                if (entriesData && entriesData.resource) {
                    const resourceStr = entriesData.resource; // e.g. file:///d%3A/%E7%94%A8%E6%88%B7%E7%9B%AE%E5%BD%95/...
                    if (resourceStr.includes('frontend/src')) {
                        // Extract the actual file path
                        let decoded = decodeURIComponent(resourceStr.replace('file:///', '').replace('file://', ''));
                        // normalize path
                        decoded = decoded.replace(/\//g, '\\');
                        
                        // We only care if it's one of our target files
                        const entries = entriesData.entries;
                        if (entries && entries.length > 0) {
                            // Find the latest valid entry
                            const latestEntry = entries[entries.length - 1];
                            const latestFilePath = path.join(folderPath, latestEntry.id);
                            if (fs.existsSync(latestFilePath)) {
                                fileToHistory.set(decoded.toLowerCase(), latestFilePath);
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }
    }

    // Now check all files in targetDir
    function walkDir(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                walkDir(fullPath);
            } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.vue')) {
                const stat = fs.statSync(fullPath);
                if (stat.size < 10) {
                    // Corrupted file!
                    const lowerPath = fullPath.toLowerCase();
                    // Let's try to find it in history
                    let historyFile = fileToHistory.get(lowerPath);
                    // Sometimes drive letter case differs
                    if (!historyFile) {
                        for (const [key, val] of fileToHistory.entries()) {
                            if (key.endsWith(fullPath.substring(3).toLowerCase())) {
                                historyFile = val;
                                break;
                            }
                        }
                    }

                    if (historyFile) {
                        const content = fs.readFileSync(historyFile, 'utf-8');
                        if (content.length > 10) {
                            fs.writeFileSync(fullPath, content, 'utf-8');
                            console.log('Restored:', fullPath);
                        } else {
                            console.log('History file also corrupted for:', fullPath);
                        }
                    } else {
                        console.log('No history found for:', fullPath);
                    }
                }
            }
        }
    }

    walkDir(targetDir);
}

restoreFiles();
console.log('Restore complete');
