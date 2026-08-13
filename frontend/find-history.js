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
                if (entriesData && entriesData.resource && entriesData.resource.includes(keyword)) {
                    const entries = entriesData.entries;
                    if (entries && entries.length > 0) {
                        const latestEntry = entries[entries.length - 1];
                        const latestFilePath = path.join(folderPath, latestEntry.id);
                        if (fs.existsSync(latestFilePath)) {
                            if (latestEntry.timestamp > maxTime) {
                                maxTime = latestEntry.timestamp;
                                best = {
                                    resource: entriesData.resource,
                                    file: latestFilePath
                                };
                            }
                        }
                    }
                }
            } catch (e) {}
        }
    }
    
    if (best) {
        console.log(`Found ${keyword} -> ${best.file}`);
        const content = fs.readFileSync(best.file, 'utf-8');
        if (content.length > 10) {
            // we could write it directly if we know where it goes
            console.log(content.substring(0, 100));
        } else {
            console.log('Content too short');
        }
    } else {
        console.log(`Not found: ${keyword}`);
    }
}

['bot.ts', 'layout-shell.ts', 'composables.ts', 'manager.ts', 'mock-strategy.ts', 'real-strategy.ts', 'platforms/index.ts', 'price-compat.ts', 'device.ts', 'MobileProfile.vue'].forEach(findFileByContent);
