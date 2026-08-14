const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FEEDBACK_DIR = path.join(__dirname, '../../docs/feedback');
const OUTPUT_FILE = path.join(FEEDBACK_DIR, 'backend.md');
const BACKEND_DIR = path.join(__dirname, '../../backend');

function ensureFeedbackDir() {
  if (!fs.existsSync(FEEDBACK_DIR)) {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  }
}

function runArchCheck() {
  console.log('🚀 运行后端架构边界检查...');
  
  try {
    const result = execSync('npm run lint:arch', {
      cwd: BACKEND_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, output: error.stdout + '\n' + error.stderr };
  }
}

function writeReport(result) {
  const timestamp = new Date().toISOString().slice(0, 10);
  
  let report = `# 后端边界检查报告

**时间戳**: ${timestamp}

## 检查工具
dependency-cruiser (npm run lint:arch)

## 检查输出
\`\`\`
${result.output}
\`\`\`
`;

  fs.writeFileSync(OUTPUT_FILE, report, 'utf-8');
  console.log(`✅ 报告已写入: ${OUTPUT_FILE}`);
}

function main() {
  ensureFeedbackDir();
  const result = runArchCheck();
  writeReport(result);
  
  if (result.success) {
    console.log('✅ 架构边界检查通过！');
    process.exit(0);
  } else {
    console.log('⚠️  发现架构边界违规，请查看报告');
    process.exit(1);
  }
}

main();
