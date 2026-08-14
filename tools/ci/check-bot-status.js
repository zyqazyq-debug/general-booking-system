const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// 颜色输出辅助函数
const colors = {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

// 加载环境变量
const envPath = path.resolve(__dirname, '../../backend/.env');
const localEnvPath = path.resolve(__dirname, '../../backend/.env.local');

// 先加载 .env
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    console.warn('⚠️  .env file not found at:', envPath);
}

// 再加载 .env.local (覆盖 .env)
if (fs.existsSync(localEnvPath)) {
    console.log(colors.blue('📄 加载 .env.local 配置文件...'));
    const envConfig = require('dotenv').parse(fs.readFileSync(localEnvPath));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
}

async function checkBotStatus() {
    console.log(colors.blue('🔍 开始检查 DEV 电报机器人状态...'));

    // 1. 获取 Token
    const token = process.env.TELEGRAM_BOT_TOKEN_DEV || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error(colors.red('❌ 错误: 未找到 TELEGRAM_BOT_TOKEN_DEV 或 TELEGRAM_BOT_TOKEN 环境变量。'));
        process.exit(1);
    }
    
    const maskedToken = token.substring(0, 4) + '...' + token.slice(-4);
    console.log(`🔑 使用 Token: ${maskedToken}`);

    // 2. 配置代理
    const proxyUrl = process.env.TELEGRAM_PROXY_URL;
    let axiosConfig = {};
    
    if (proxyUrl) {
        console.log(`🌐 使用代理: ${proxyUrl}`);
        try {
            const agent = proxyUrl.startsWith('socks') 
                ? new SocksProxyAgent(proxyUrl) 
                : new HttpsProxyAgent(proxyUrl);
            
            axiosConfig = {
                httpsAgent: agent,
                proxy: false
            };
        } catch (e) {
            console.error(colors.red(`❌ 代理配置失败: ${e.message}`));
            process.exit(1);
        }
    } else {
        console.log('🌐 未配置代理 (TELEGRAM_PROXY_URL)');
    }

    // 3. 调用 Telegram API
    try {
        const startTime = Date.now();
        const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`, axiosConfig);
        const duration = Date.now() - startTime;
        
        const data = response.data;
        if (data.ok) {
            console.log('\n' + colors.green('✅ 检查成功! 机器人在线'));
            console.log('----------------------------------------');
            console.log(`🤖 Bot ID:       ${data.result.id}`);
            console.log(`👤 Username:     @${data.result.username}`);
            console.log(`📝 Display Name: ${data.result.first_name}`);
            console.log(`⏱️  响应耗时:     ${duration}ms`);
            console.log('----------------------------------------');
            
            // 额外检查 Webhook 状态
            await checkWebhookStatus(token, axiosConfig);

        } else {
            console.error(colors.red('❌ API 返回错误:'), JSON.stringify(data, null, 2));
            process.exit(2);
        }

    } catch (error) {
        console.error('\n' + colors.red('❌ 请求失败'));
        console.error(`Error: ${error.message}`);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(3);
    }
}

async function checkWebhookStatus(token, config) {
    try {
        console.log(colors.blue('\n🔍 检查 Webhook 配置...'));
        const response = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`, config);
        const info = response.data.result;
        
        console.log('----------------------------------------');
        console.log(`🔗 URL: ${info.url || '(无 - Polling 模式)'}`);
        if (info.last_error_message) {
            console.log(colors.red(`⚠️  最近错误: ${info.last_error_message}`));
            console.log(`📅 错误时间: ${new Date(info.last_error_date * 1000).toLocaleString()}`);
        }
        if (info.pending_update_count > 0) {
            console.log(colors.yellow(`📦 积压更新: ${info.pending_update_count} 个`));
        } else {
            console.log(colors.green('✨ 无积压更新'));
        }
        console.log('----------------------------------------');

    } catch (e) {
        console.error(colors.yellow(`⚠️  无法获取 Webhook 信息: ${e.message}`));
    }
}

checkBotStatus();
