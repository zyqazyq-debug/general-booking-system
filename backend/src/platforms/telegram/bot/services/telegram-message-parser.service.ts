import { Injectable } from '@nestjs/common';

type ImportErrorRule = {
  matches: (errorText: string, queryErrorCode?: string) => boolean;
  message: string;
};

@Injectable()
export class TelegramMessageParserService {
  extractImportInput(normalizedText: string): string {
    const collectCommandMatch = normalizedText.match(/^收藏\s+(.+)$/);
    return collectCommandMatch && collectCommandMatch[1]
      ? collectCommandMatch[1].trim()
      : normalizedText;
  }

  buildImportFailureMessage(params: {
    content: string;
    errorText: string;
    queryErrorCode?: string;
  }): string | null {
    const { content, errorText, queryErrorCode } = params;
    const fixedMessage = this.resolveImportErrorFixedMessage(
      errorText,
      queryErrorCode,
    );
    if (fixedMessage) {
      return fixedMessage;
    }
    if (this.isImportTargetMissing(errorText)) {
      return content.length >= 8 || content.includes('http')
        ? '未找到对应服务，请确认链接或二维码是否正确。'
        : null;
    }
    if (this.isUnknownObjectError(errorText)) {
      return content.length > 5
        ? '无法识别指令或链接。如需收藏，请发送分享链接或二维码。'
        : null;
    }
    return `处理失败: ${errorText}`;
  }

  private resolveImportErrorFixedMessage(
    errorText: string,
    queryErrorCode?: string,
  ): string | null {
    const rules: ImportErrorRule[] = [
      {
        matches: (text) => text.includes('Circular'),
        message: '无法收藏：循环依赖',
      },
      {
        matches: (text) => text.includes('Collection active limit exceeded'),
        message: '无法收藏：已达可上架收藏数量上限，请先扩容或下架',
      },
      {
        matches: (text, code) =>
          text.includes('already exists') || code === '23505',
        message: '您已收藏过该服务',
      },
      {
        matches: (text) =>
          text.includes('not active') || text.includes('unavailable'),
        message: '该服务已失效，无法收藏。',
      },
    ];

    for (const rule of rules) {
      if (rule.matches(errorText, queryErrorCode)) {
        return rule.message;
      }
    }
    return null;
  }

  private isImportTargetMissing(errorText: string): boolean {
    return (
      errorText.includes('not found') ||
      errorText.includes('Node not found') ||
      errorText.includes('No valid import code')
    );
  }

  private isUnknownObjectError(errorText: string): boolean {
    const looksLikeObjectError =
      /^\[object\s.+\]$/i.test(errorText) || /\[object\s.+\]/i.test(errorText);
    return !errorText || looksLikeObjectError;
  }
}
