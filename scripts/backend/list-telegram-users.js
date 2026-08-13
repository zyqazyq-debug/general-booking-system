const { DataSource } = require('typeorm');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// 颜色输出
const colors = {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

async function listTelegramUsers() {
    console.log(colors.blue('🔍 正在查询已绑定的 Telegram 用户列表...'));

    // 1. 加载环境变量 (优先加载 .env.development)
    const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
    const envPath = path.resolve(__dirname, `../../${envFile}`);
    
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        console.log(`📄 已加载配置: ${envFile}`);
    } else {
        console.warn(colors.yellow(`⚠️  未找到 ${envFile}，尝试加载默认 .env`));
        dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    }

    // 2. 初始化数据库连接
    const AppDataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        username: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'password',
        database: process.env.POSTGRES_DB || 'booking_db',
        entities: [],
        synchronize: false,
        logging: false,
    });

    try {
        await AppDataSource.initialize();
        console.log(colors.green('✅ 数据库连接成功'));

        // 3. 查询绑定了 Telegram 的用户
        // 由于没有直接加载实体类（为了避免复杂的依赖编译），直接使用 SQL 查询
        const users = await AppDataSource.query(`
            SELECT id, username, nickname, telegram_chat_id, telegram_username, created_at, roles
            FROM "user"
            WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != ''
            ORDER BY updated_at DESC
        `);

        if (users.length === 0) {
            console.log(colors.yellow('⚠️  暂无已绑定的 Telegram 用户。'));
        } else {
            console.log(colors.green(`🎉 发现 ${users.length} 个 Telegram 对话 (已绑定用户):`));
            console.log('---------------------------------------------------------------------------------');
            console.log('| ID | Username | Nickname | TG Username | TG Chat ID | Roles |');
            console.log('---------------------------------------------------------------------------------');
            users.forEach(u => {
                const tgUser = u.telegram_username ? `@${u.telegram_username}` : '(无用户名)';
                const roles = u.roles ? u.roles.replace(/,/g, ', ') : 'CONSUMER';
                console.log(`| ${u.id.substring(0, 6)}.. | ${u.username.padEnd(10)} | ${u.nickname || '-'} | ${tgUser.padEnd(12)} | ${u.telegram_chat_id} | ${roles} |`);
            });
            console.log('---------------------------------------------------------------------------------');
        }

    } catch (error) {
        console.error(colors.red('❌ 查询失败:'), error.message);
    } finally {
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
        }
    }
}

listTelegramUsers();
