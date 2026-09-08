import { Controller, Get, Param, Res, Inject } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AgencyLinkQueryPort } from '../agency';
import { AGENCY_LINK_QUERY_PORT } from '../agency';

@Controller('link')
export class LinkController {
  constructor(
    @Inject(AGENCY_LINK_QUERY_PORT)
    private readonly agencyLinkQueryPort: AgencyLinkQueryPort,
  ) {}

  @Get('resolve/:code')
  @ApiOperation({ summary: 'Resolve a referral or shared-booking link' })
  @ApiProduces('text/html')
  @ApiResponse({ status: 200, description: 'HTML page that immediately forwards the visitor to the resolved route.', content: { 'text/html': { schema: { type: 'string' } } } })
  @ApiResponse({ status: 404, description: 'HTML page explaining that the requested link is unavailable.', content: { 'text/html': { schema: { type: 'string' } } } })
  async resolve(
    @Param('code') rawCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const code = rawCode.trim();
    const safeCode = code;
    const normalizedReferral = safeCode.toUpperCase();

    if (normalizedReferral.startsWith('R')) {
      const target = `/#/pages/login/register?ref=${encodeURIComponent(normalizedReferral)}`;
      this.sendRedirectHtml(res, target);
      return;
    }

    const exists = await this.agencyLinkQueryPort.existsByShareSlug(safeCode);
    if (exists) {
      const target = `/#/pages/booking/detail?slug=${encodeURIComponent(safeCode)}`;
      this.sendRedirectHtml(res, target);
      return;
    }

    this.sendNotFoundHtml(res, safeCode);
  }

  private sendRedirectHtml(res: Response, target: string) {
    const escaped = String(target || '/#/')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const normalizedTarget = target || '/#/';
    const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow"/><meta http-equiv="refresh" content="0;url=${escaped}"/><title>Redirecting</title><style>html,body{width:100%;height:100%;margin:0;padding:0;background:#fff;}</style><script>location.replace(${JSON.stringify(
      normalizedTarget,
    )});</script></head><body><noscript><meta http-equiv="refresh" content="0;url=${escaped}"/><a href="${escaped}">${escaped}</a></noscript></body></html>`;

    res
      .status(200)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Cache-Control', 'no-store');
    res.send(html);
  }

  private sendNotFoundHtml(res: Response, code: string) {
    const safe = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const home = '/#/';
    const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow"/><title>Link Not Found</title><style>html,body{height:100%;margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif} .wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box} .card{max-width:520px;width:100%;border:1px solid #eee;border-radius:12px;padding:18px 16px} .title{font-size:18px;font-weight:600;margin:0 0 8px} .desc{font-size:13px;color:#666;margin:0 0 10px;line-height:1.5} .code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;background:#f7f7f7;padding:6px 8px;border-radius:8px;display:inline-block} .btn{display:inline-block;margin-top:14px;padding:10px 12px;border-radius:10px;background:#1677ff;color:#fff;text-decoration:none;font-size:14px}</style></head><body><div class="wrap"><div class="card"><p class="title">链接已失效</p><p class="desc">该链接不存在、已过期或已下线。</p><div class="code">${safe}</div><div><a class="btn" href="${home}">返回首页</a></div></div></div></body></html>`;
    res
      .status(404)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Cache-Control', 'no-store');
    res.send(html);
  }
}
