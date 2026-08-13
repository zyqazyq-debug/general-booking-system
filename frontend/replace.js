const fs = require('fs');
const path = require('path');

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.vue')) {
            let content = fs.readFileSync(fullPath, 'utf-8');
            if (content.includes('@/domains/service/api/service')) {
                content = content.replace(/@\/domains\/service\/api\/service/g, '@/shared/api/service');
                fs.writeFileSync(fullPath, content, 'utf-8');
                console.log('Updated:', fullPath);
            }
        }
    }
}

walkDir(path.join(__dirname, 'src'));
console.log('Done');