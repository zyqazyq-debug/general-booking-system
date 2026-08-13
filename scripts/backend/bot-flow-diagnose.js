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
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

async function diagnose(envName, envFile) {
    console.log(colors.blue(`\n🕵️  开始深度诊断 [${envName}] 环境...`));

    // 1. 加载对应环境配置
    // 修改为从项目根目录读取 .env 文件 (../../)
    const envPath = path.resolve(__dirname, `../../${envFile}`);
    if (!fs.existsSync(envPath)) {
        console.error(colors.red(`❌ 找不到 ${envFile} 文件 (路径: ${envPath})`));
        return;
    }
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    const token = envConfig.TELEGRAM_BOT_TOKEN;
    // Prod 环境可能没有显式配置代理，回退到系统环境变量或默认值
    const proxyUrl = envConfig.TELEGRAM_PROXY_URL || process.env.TELEGRAM_PROXY_URL || 'http://192.168.3.5:7893';

    if (!token) {
        console.error(colors.red('❌ TELEGRAM_BOT_TOKEN 未配置'));
        return;
    }

    console.log(`🔑 Token: ${token.substring(0, 10)}...`);
    console.log(`🌐 Proxy: ${proxyUrl}`);

    // 配置 Axios
    let axiosConfig = {};
    if (proxyUrl) {
        const agent = proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
        axiosConfig = { httpsAgent: agent, proxy: false };
    }

    try {
        // 2. 检查 Bot 自身信息
        const meRes = await axios.get(`https://api.telegram.org/bot${token}/getMe`, axiosConfig);
        const bot = meRes.data.result;
        console.log(colors.green(`✅ Bot 身份确认: @${bot.username} (${bot.first_name})`));

        // 3. 核心：检查 Webhook 状态
        console.log(colors.blue('🔍 检查 Webhook 状态...'));
        const webhookRes = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`, axiosConfig);
        const webhook = webhookRes.data.result;

        if (webhook.url) {
            console.log(colors.red(`⚠️  发现 Webhook 已设置！`));
            console.log(`🔗 URL: ${colors.bold(webhook.url)}`);
            console.log(`📦 Pending Updates: ${webhook.pending_update_count}`);
            console.log(`📅 Last Error: ${webhook.last_error_message || 'None'}`);
            
            if (webhook.url.includes('synology.me')) {
                console.log(colors.yellow('👉 结论: 消息变“已读”是因为 Webhook 指向了 NAS/群晖域名。'));
            } else {
                console.log(colors.yellow(`👉 结论: 消息被推送到上述 URL。`));
            }
        } else {
            console.log(colors.green(`✅ Webhook 未设置 (当前为 Polling 模式)`));
            console.log(`📦 Pending Updates: ${webhook.pending_update_count}`);
            
            if (webhook.pending_update_count > 0) {
                console.log(colors.cyan('📥 尝试主动拉取最近 10 条积压消息...'));
                try {
                    // limit=10, 移除 offset=0 限制，使用 update_id 递增拉取
                    const updatesRes = await axios.get(`https://api.telegram.org/bot${token}/getUpdates?limit=10`, axiosConfig);
                    const updates = updatesRes.data.result;
                    if (updates.length > 0) {
                        console.log(colors.green(`✅ 成功拉取到 ${updates.length} 条消息!`));
                        
                        updates.forEach((update, index) => {
                            const msg = update.message || update.edited_message || update.channel_post;
                            console.log(`\n[消息 ${index + 1}] ID: ${update.update_id}`);
                            if (msg) {
                                console.log(`   - 发送者: ${msg.from?.first_name} (@${msg.from?.username})`);
                                console.log(`   - 内容: "${msg.text}"`);
                                console.log(`   - 时间: ${new Date(msg.date * 1000).toLocaleString()}`);
                            } else {
                                console.log(`   - 类型: ${Object.keys(update).find(k => k !== 'update_id')}`);
                                console.log(JSON.stringify(update, null, 2));
                            }
                        });
                    } else {
                        console.log(colors.yellow('⚠️  未拉取到消息。请确认：\n1. 您是否真的给这个 Token 的 Bot 发了消息？\n2. 消息是否已被其他进程（如后台未退出的 node）抢先消费？'));
                    }
                } catch (e) {
                    console.error(colors.red(`❌ 拉取失败: ${e.message}`));
                }
            } else {
                console.log(colors.yellow('❓ 无积压消息。如果消息变“已读”，说明刚才肯定有东西消费了它。'));
            }
        }

    } catch (e) {
        console.error(colors.red(`❌ 诊断过程出错: ${e.message}`));
        if (e.response) console.error(e.response.data);
    }
}

async function run() {
    await diagnose('Development', '.env.development');
    await diagnose('Production', '.env.production');
}

run();
