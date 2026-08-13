import { request } from '@/shared/api/request';
import { resolveDistributionLink, type DistributionLinkInfo } from '@/domains/library';

const extractTokenOrSlug = (input: string) => {
  if (!input) return '';
  const trimmed = String(input).trim();
  const tokenMatch = trimmed.match(/[?&](token|slug|s)=([a-zA-Z0-9_-]+)/i);
  if (tokenMatch?.[2]) return tokenMatch[2];
  return trimmed;
};

/**
 * 解析统一链接（仅支持分销短码/slug）
 */
export const resolveUnifiedLink = async (
  code: string,
): Promise<DistributionLinkInfo> => {
  const value = extractTokenOrSlug(code);
  if (!value) {
    throw new Error('Invalid link code');
  }

  return resolveDistributionLink(value);
};
