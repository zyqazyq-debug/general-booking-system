const fs = require('fs');
const { execSync } = require('child_process');

function checkoutFile(repoPath, src, dest) {
    const content = execSync(`git --no-pager show HEAD:${src}`, { cwd: repoPath, encoding: 'utf-8' });
    fs.writeFileSync(dest, content, 'utf-8');
    console.log('Checked out', dest);
}

const repoPath = 'D:\\用户目录\\桌面\\编程\\通用预约系统';
checkoutFile(repoPath, 'frontend/src/pages/admin/login.vue', 'D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src\\domains\\admin\\pages\\AdminLoginImpl.vue');
checkoutFile(repoPath, 'frontend/src/pages/admin/users.vue', 'D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src\\domains\\admin\\pages\\AdminUsersImpl.vue');
checkoutFile(repoPath, 'frontend/src/pages/order/manage.vue', 'D:\\用户目录\\桌面\\编程\\通用预约系统\\frontend\\src\\domains\\order\\pages\\OrderManageImpl.vue');
