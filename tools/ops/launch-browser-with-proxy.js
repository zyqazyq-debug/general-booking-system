const puppeteer = require('puppeteer');

(async () => {
  const proxyServer = 'http://192.168.3.5:7893'; // 用户指定的代理
  console.log(`正在启动浏览器，代理设置为: ${proxyServer}`);
  console.log('注意：请确保该代理地址在您的网络环境中是可用的。');

  try {
    const browser = await puppeteer.launch({
      headless: false, // 可视化模式，用户可以看到浏览器窗口
      defaultViewport: null, // 禁用默认视口大小，允许窗口调整
      args: [
        `--proxy-server=${proxyServer}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized', // 启动时最大化
        '--remote-debugging-port=9222' // 开启远程调试端口，允许 AI 连接
      ]
    });

    // 获取 WebSocket Endpoint，方便后续连接
    const wsEndpoint = browser.wsEndpoint();
    console.log(`\n🔍 远程调试地址 (WS Endpoint): ${wsEndpoint}`);
    console.log('🤖 AI 助手现在可以通过此地址连接并操作该浏览器窗口。');


    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    // 1. 验证代理连接 (访问 ipinfo.io)
    console.log('正在验证代理连接 (ipinfo.io)...');
    try {
        await page.goto('https://ipinfo.io/json', { waitUntil: 'domcontentloaded', timeout: 15000 });
        const content = await page.$eval('body', el => el.textContent);
        console.log('当前 IP 信息:', content);
    } catch (e) {
        console.error('无法连接到 ipinfo.io，请检查代理是否生效:', e.message);
    }

    // 2. 打开 Telegram Web
    console.log('正在跳转至 Telegram Web (https://web.telegram.org/k/)...');
    try {
        // 使用 /k/ 版本，通常更稳定
        await page.goto('https://web.telegram.org/k/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('Telegram Web 加载完成。');
    } catch (e) {
        console.error('加载 Telegram Web 超时或失败:', e.message);
    }

    console.log('--------------------------------------------------');
    console.log('浏览器已启动并保持运行。');
    console.log('您可以在弹出的 Chromium 窗口中手动操作登录。');
    console.log('若要关闭，请在终端按 Ctrl+C 或直接关闭浏览器窗口。');
    console.log('--------------------------------------------------');

    // 监听浏览器关闭事件
    browser.on('disconnected', () => {
      console.log('浏览器已关闭。');
      process.exit(0);
    });

  } catch (error) {
    console.error('启动浏览器失败:', error);
    process.exit(1);
  }
})();
