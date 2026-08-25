/**
 * Next.js instrumentation hook。
 *
 * 生产环境下 FaaS 实例空闲 30–50 分钟会被回收，冷启动 1–20 秒不等，
 * 期间超星推送会因为回调超时（通常 5–10s）失败。
 *
 * 这里在 Node.js runtime 启动后拉起一个保活定时器：
 *  - 每 4 分钟请求一次本机 /api/health，触发一次请求处理周期；
 *  - 只在生产环境启用，且只在主线程启动一次；
 *  - 不依赖外部 cron 服务，失败只打日志，不抛出。
 *
 * 注意：FaaS 平台是否真正因为自请求而保活取决于具体实现；
 * 如果无效，需要平台侧配置 min-instances 或外部 uptime 探针。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.COZE_PROJECT_ENV !== 'PROD' && process.env.NODE_ENV !== 'production') return;
  if (process.env.DISABLE_KEEPALIVE === '1') return;

  const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS || 4 * 60 * 1000);
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return;

  const port = process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';
  const url = `http://127.0.0.1:${port}/api/health`;

  let timer: NodeJS.Timeout | null = null;

  const ping = async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        console.error(`[keepalive] health check returned ${res.status}`);
      }
    } catch (err) {
      console.error('[keepalive] ping failed:', (err as Error).message);
    }
  };

  // 启动后延迟 30s 再开始，避免和冷启动抢占资源
  setTimeout(() => {
    ping();
    timer = setInterval(ping, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    console.log(`[keepalive] started, pinging ${url} every ${intervalMs}ms`);
  }, 30_000);
}
