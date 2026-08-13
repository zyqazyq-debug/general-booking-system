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
                if (entriesData && entriesData.resource && entriesData.resource.includes('service.ts')) {
                    const entries = entriesData.entries;
                    if (entries && entries.length > 0) {
                        const latestEntry = entries[entries.length - 1];
                        const latestFilePath = path.join(folderPath, latestEntry.id);
                        if (fs.existsSync(latestFilePath)) {
                            const content = fs.readFileSync(latestFilePath, 'utf-8');
                            if (content.includes(keyword) && latestEntry.timestamp > maxTime) {
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
        console.log(`Found ${keyword} -> ${best}`);
        const content = fs.readFileSync(best, 'utf-8');
        fs.writeFileSync('D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src\\domains\\provider\\stores\\service.ts', content);
        console.log('Restored store to domains/provider/stores/service.ts');
    } else {
        console.log(`Not found: ${keyword}`);
    }
}

findFileByContent('useServiceStore');
