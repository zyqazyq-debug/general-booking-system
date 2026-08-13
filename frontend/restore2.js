const fs = require('fs');
const path = require('path');

const historyDir = 'C:\\Users\\realzyq\\AppData\\Roaming\\trae\\User\\History';
const targetDir = 'D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src';

function restoreFiles() {
    const historyFolders = fs.readdirSync(historyDir);
    const nameToHistory = new Map();

    // Map all history entries by BASENAME
    for (const folder of historyFolders) {
        const folderPath = path.join(historyDir, folder);
        const entriesPath = path.join(folderPath, 'entries.json');
        if (fs.existsSync(entriesPath)) {
            try {
                const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
                if (entriesData && entriesData.resource) {
                    const resourceStr = entriesData.resource; 
                    if (resourceStr.includes('frontend/src')) {
                        const decoded = decodeURIComponent(resourceStr.replace('file:///', '').replace('file://', ''));
                        const basename = path.basename(decoded).toLowerCase();
                        
                        const entries = entriesData.entries;
                        if (entries && entries.length > 0) {
                            const latestEntry = entries[entries.length - 1];
                            const latestFilePath = path.join(folderPath, latestEntry.id);
                            if (fs.existsSync(latestFilePath)) {
                                if (!nameToHistory.has(basename)) {
                                    nameToHistory.set(basename, []);
                                }
                                nameToHistory.get(basename).push({
                                    path: decoded.toLowerCase().replace(/\//g, '\\'),
                                    historyFile: latestFilePath,
                                    timestamp: latestEntry.timestamp
                                });
                            }
                        }
                    }
                }
            } catch (e) {
            }
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
                if (stat.size < 10) {
                    const basename = path.basename(fullPath).toLowerCase();
                    const candidates = nameToHistory.get(basename) || [];
                    
                    // Sort by timestamp desc
                    candidates.sort((a, b) => b.timestamp - a.timestamp);
                    
                    // Find best match
                    let bestMatch = candidates.find(c => fullPath.toLowerCase().endsWith(c.path));
                    if (!bestMatch && candidates.length > 0) {
                        bestMatch = candidates[0]; // fallback to most recent
                    }

                    if (bestMatch) {
                        const content = fs.readFileSync(bestMatch.historyFile, 'utf-8');
                        if (content.length > 10) {
                            fs.writeFileSync(fullPath, content, 'utf-8');
                            console.log('Restored via basename:', fullPath);
                        }
                    } else {
                        console.log('STILL NO HISTORY FOR:', fullPath);
                    }
                }
            }
        }
    }

    walkDir(targetDir);
}

restoreFiles();
console.log('Done fallback restore');
