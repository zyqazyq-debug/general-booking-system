const { execSync } = require('child_process');
const path = require('path');

const ports = [3001, 8443];
// 项目路径特征，用于识别相关的 node 进程
const PROJECT_PATH_IDENTIFIERS = ['通用预约系统', 'happybooking'];

console.log('🧹 Cleaning up ports:', ports.join(', '));

// 1. 按端口清理
ports.forEach(port => {
  try {
    // Windows command to find PID by port
    const stdout = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`).toString();
    const lines = stdout.split('\n');
    
    const pids = new Set();
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length > 4) {
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          pids.add(pid);
        }
      }
    });

    pids.forEach(pid => {
      try {
        console.log(`🔫 Killing process ${pid} on port ${port}...`);
        execSync(`taskkill /F /PID ${pid}`);
      } catch (e) {
        // Ignore errors if process already exited
      }
    });
  } catch (e) {
    // No process found on this port, which is fine
  }
});

// 2. 按命令行特征清理残留的 Node 进程
console.log('🧹 Scanning for orphaned node processes...');
try {
    // 获取所有 node 进程信息
    const wmicOutput = execSync('wmic process where "name=\'node.exe\'" get commandline,processid').toString();
    const lines = wmicOutput.split('\n');
    
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        
        // 匹配最后一列为 PID
        const match = trimmed.match(/^(.*)\s+(\d+)$/);
        if (!match) return;
        
        const commandLine = match[1];
        const pid = match[2];
        
        // 检查是否包含项目路径特征，且包含 nest start 或 vite/uni 相关命令
        const isProjectProcess = PROJECT_PATH_IDENTIFIERS.some(id => commandLine.includes(id));
        const isTargetCommand = commandLine.includes('nest start') || 
                              commandLine.includes('vite') || 
                              commandLine.includes('uni.js');
        
        // 排除当前脚本自己 (cleanup-ports.js)
        const isSelf = commandLine.includes('cleanup-ports.js');

        // 关键逻辑：
        // 1. 如果是项目内的关键进程 (nest/vite)，直接杀
        // 2. 如果是无参数的 'node' 且在项目目录下运行（可能是残留），杀
        if ((isProjectProcess && isTargetCommand && !isSelf)) {
            try {
                // Double check it's not me
                if (pid == process.pid) return;

                console.log(`🔫 Killing orphaned node process ${pid}: ${commandLine.substring(0, 60)}...`);
                execSync(`taskkill /F /PID ${pid}`);
            } catch (e) {
                // Ignore
            }
        }
    });
} catch (e) {
    console.warn('⚠️  Failed to scan orphaned processes:', e.message);
}

console.log('✅ Cleanup finished.');
