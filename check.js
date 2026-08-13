const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else if (file.endsWith('.ts') || file.endsWith('.vue')) {
            results.push(file);
        }
    });
    return results;
}

const frontendSrc = path.join(process.cwd(), 'frontend', 'src');
const files = walk(frontendSrc);

let found = false;

for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let currentDomain = null;
    
    // Normalize path separators for matching
    const normalizedFile = file.replace(/\\/g, '/');
    const domainMatch = normalizedFile.match(/frontend\/src\/domains\/([^\/]+)/);
    if (domainMatch) {
        currentDomain = domainMatch[1];
    }
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Match @/domains/xxx/yyy
        const matchAt = line.match(/from\s+['"]@\/domains\/([^\/]+)\/(.+)['"]/);
        if (matchAt) {
            const importedDomain = matchAt[1];
            if (importedDomain !== currentDomain) {
                // If the import is exactly the domain root (e.g. @/domains/xxx), the regex won't match if there's no slash.
                // Wait, if it has a slash, it's a deep import!
                // But wait, what if it's `@/domains/xxx`? The regex requires a slash.
                console.log(`[!] (Absolute Deep) ${file.replace(process.cwd(), '')}:${i+1}: ${line.trim()}`);
                found = true;
            }
        }
        
        // Match ../../xxx/yyy where it might cross domain
        const matchRel = line.match(/from\s+['"]((\.\.\/)+)(.+)['"]/);
        if (matchRel && currentDomain) {
            const importPathStr = matchRel[1] + matchRel[3];
            const resolvedPath = path.resolve(path.dirname(file), importPathStr).replace(/\\/g, '/');
            if (resolvedPath.includes('frontend/src/domains')) {
                const resolvedDomainMatch = resolvedPath.match(/frontend\/src\/domains\/([^\/]+)/);
                if (resolvedDomainMatch) {
                    const importedDomain = resolvedDomainMatch[1];
                    if (importedDomain !== currentDomain) {
                        const relativeToImportedDomain = resolvedPath.substring(resolvedPath.indexOf('domains/' + importedDomain) + ('domains/' + importedDomain).length + 1);
                        if (relativeToImportedDomain && relativeToImportedDomain !== 'index.ts' && relativeToImportedDomain !== 'index.vue' && relativeToImportedDomain !== 'index' && relativeToImportedDomain !== '') {
                            console.log(`[!] (Relative Deep) ${file.replace(process.cwd(), '')}:${i+1}: ${line.trim()} (resolved to ${resolvedPath})`);
                            found = true;
                        }
                    }
                }
            }
        }
    }
}
if (!found) console.log('No cross-domain deep imports found.');