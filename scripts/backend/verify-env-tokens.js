const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// 颜色输出
const colors = {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    blue: (text) => `\x1b[34m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

async function checkToken(envName, filePath) {
    console.log(colors.blue(`\n🔍 正在检查 [${envName}] 环境配置...`));
    
    if (!fs.existsSync(filePath)) {
        console.error(colors.red(`❌ 文件不存在: ${filePath}`));
        return;
    }

    const envConfig = dotenv.parse(fs.readFileSync(filePath));
    const token = envConfig.TELEGRAM_BOT_TOKEN;
    const configName = envConfig.TELEGRAM_BOT_NAME;
    const proxyUrl = envConfig.TELEGRAM_PROXY_URL || process.env.TELEGRAM_PROXY_URL || 'http://192.168.3.5:7893'; // Fallback to known proxy

    if (!token) {
        console.error(colors.red('❌ 未找到 TELEGRAM_BOT_TOKEN'));
        return;
    }

    console.log(`📄 配置文件: ${path.basename(filePath)}`);
    console.log(`🔑 Token前缀: ${token.substring(0, 15)}...`);
    console.log(`📝 配置名称: @${configName}`);

    // 配置代理
    let axiosConfig = {};
    if (proxyUrl) {
        try {
            const agent = proxyUrl.startsWith('socks') 
                ? new SocksProxyAgent(proxyUrl) 
                : new HttpsProxyAgent(proxyUrl);
            axiosConfig = { httpsAgent: agent, proxy: false };
        } catch (e) {
            console.error(colors.red(`代理配置错误: ${e.message}`));
        }
    }

    try {
        const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, axiosConfig);
        const bot = res.data.result;
        
        const realUsername = bot.username;
        const isMatch = realUsername === configName;

        if (isMatch) {
            console.log(colors.green(`✅ 验证通过! Token 对应机器人: @${realUsername} (${bot.first_name})`));
        } else {
            console.log(colors.red(`❌ 验证失败! 配置文件称是 @${configName}, 但 Token 实际对应 @${realUsername}`));
            console.log(colors.yellow(`⚠️  可能配置反了！`));
        }
        
    } catch (e) {
        console.error(colors.red(`❌ 请求失败: ${e.message}`));
        if (e.response) {
            console.error(`HTTP Status: ${e.response.status}`);
        }
    }
}

async function run() {
    await checkToken('Development', path.resolve(__dirname, '../../backend/.env.development'));
    await checkToken('Production', path.resolve(__dirname, '../../backend/.env.production'));
}

run();
