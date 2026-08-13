const fs = require('fs');
const path = require('path');

const historyDir = 'C:\\Users\\realzyq\\AppData\\Roaming\\trae\\User\\History';

function findFileByContent(keyword) {
    const historyFolders = fs.readdirSync(historyDir);
    let best = null;
    let maxTime = 0;
    
    for (const folder of historyFolders) {
        const folderPath = path.join(historyDir, folder);
        const entriesPath = path.join(folderPath, 'entries.json');
        if (fs.existsSync(entriesPath)) {
            try {
                const entriesData = JSON.parse(fs.readFileSync(entriesPath, 'utf-8'));
                if (entriesData && entriesData.resource && entriesData.resource.includes('AppCard.vue')) {
                    const entries = entriesData.entries;
                    if (entries && entries.length > 0) {
                        const latestEntry = entries[entries.length - 1];
                        const latestFilePath = path.join(folderPath, latestEntry.id);
                        if (fs.existsSync(latestFilePath)) {
                            const content = fs.readFileSync(latestFilePath, 'utf-8');
                            if (content.length > 20 && latestEntry.timestamp > maxTime) {
                                maxTime = latestEntry.timestamp;
                                best = latestFilePath;
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    }
    
    if (best) {
        console.log(`Found -> ${best}`);
        const content = fs.readFileSync(best, 'utf-8');
        fs.writeFileSync('D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src\\shared\\components\\AppCard.vue', content);
        console.log('Restored AppCard.vue');
    }
}

findFileByContent('AppCard.vue');
