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
            let modified = false;

            const replaces = [
                [/@\/stores\/user/g, '@/shared/stores/user'],
                [/@\/api\/user/g, '@/domains/user/api/user'],
                [/@\/api\/order/g, '@/domains/order/api/order'],
                [/@\/api\/agent/g, '@/domains/distribution/api/agent'],
                [/@\/api\/schedule/g, '@/shared/api/service'],
                [/@\/api\/share-link/g, '@/domains/distribution/api/link']
            ];

            for (const [regex, replacement] of replaces) {
                if (regex.test(content)) {
                    content = content.replace(regex, replacement);
                    modified = true;
                }
            }

            if (modified) {
                fs.writeFileSync(fullPath, content, 'utf-8');
                console.log('Fixed imports:', fullPath);
            }
        }
    }
}

walkDir(path.join(__dirname, 'src'));
console.log('Done fixing imports');
