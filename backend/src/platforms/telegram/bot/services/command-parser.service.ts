import { Injectable } from '@nestjs/common';

export interface ParsedMarkupCommand {
  markupType: 'FIXED' | 'PERCENTAGE';
  markupValue: number;
}

export interface ParsedImportCommand {
  code: string; // Slug or Token or Raw Code
  markupOptions?: ParsedMarkupCommand;
  alias?: string;
}

@Injectable()
export class CommandParserService {
  /**
   * Parse user text into markup instructions.
   * Supported formats:
   * - "加价 100" -> Fixed 100
   * - "加价 10%" -> Percentage 10
   * - "加价 50%"
   * - "100" -> Fixed 100 (Implicit, if strict=false)
   *
   * @param text User input string
   * @param strict If true, requires "加价" or explicit context keyword. Default false.
   */
  parseMarkupCommand(text: string, strict = false): ParsedMarkupCommand | null {
    if (!text) return null;
    const cleanText = text.trim();
    const signedNumberMatch = cleanText.match(/[-+]?\d+(?:\.\d+)?/);
    const hasNegative =
      !!signedNumberMatch && signedNumberMatch[0].startsWith('-');
    if (hasNegative) {
      return null;
    }
    const numberText = signedNumberMatch?.[0];
    const num = numberText ? parseFloat(numberText) : NaN;

    // Pattern for Percentage: "加价 10%" or "10%" or "百分之10"
    if (
      cleanText.includes('%') ||
      cleanText.includes('％') ||
      cleanText.includes('百分之')
    ) {
      if (!isNaN(num) && num > 0) {
        // Exclude inputs that look like full URLs (e.g. they might have % in the encoded slug)
        if (cleanText.includes('http://') || cleanText.includes('https://')) {
          return null;
        }
        return { markupType: 'PERCENTAGE', markupValue: num };
      }
      return null;
    }

    // Pattern for Fixed: "加价 100" or "100"
    if (!isNaN(num) && num > 0) {
      // Exclude inputs that look like full URLs
      if (cleanText.includes('http://') || cleanText.includes('https://')) {
        return null;
      }
      // If strict mode, require keyword for pure numbers to avoid confusion with other inputs
      if (
        strict &&
        !cleanText.includes('加价') &&
        !cleanText.toLowerCase().includes('markup')
      ) {
        return null;
      }
      return { markupType: 'FIXED', markupValue: num };
    }

    return null;
  }

  /**
   * Parse import text to extract code (slug/token) and optional markup instructions.
   * Supports URL parsing, token extraction, and natural language markup commands.
   *
   * @param content User input content (URL, text, etc.)
   */
  parseImportText(content: string): ParsedImportCommand {
    let code = content.trim();
    let markupOptions: ParsedMarkupCommand | undefined;

    // 1. Extract Markup Instructions
    // Try to find explicit markup command in the text
    // Regex for: "加价/markup" (optional "百分之") (number) (optional "%")
    // e.g. "加价 10", "markup 10%", "加价百分之5"

    const percentPattern =
      /(?:加价|markup)\s*(?:百分之)?\s*(\d+(?:\.\d+)?)\s*(?:%|％)/i;
    const chinesePercentPattern = /加价\s*百分之\s*(\d+(?:\.\d+)?)/;
    const fixedPattern = /(?:加价|markup)\s*(\d+(?:\.\d+)?)(?!\s*(?:%|％))/i;

    let markupMatch =
      content.match(percentPattern) || content.match(chinesePercentPattern);

    if (markupMatch) {
      markupOptions = {
        markupType: 'PERCENTAGE',
        markupValue: parseFloat(markupMatch[1]),
      };
    } else {
      markupMatch = content.match(fixedPattern);
      if (markupMatch) {
        markupOptions = {
          markupType: 'FIXED',
          markupValue: parseFloat(markupMatch[1]),
        };
      }
    }

    // 2. Extract Code (Slug/Token)
    try {
      // 2.1 Try to find token=... or slug=... in query or hash (Most reliable)
      const tokenMatch =
        content.match(/[?&](token|slug|s)\s*=\s*([a-zA-Z0-9_-]+)/) ||
        content.match(/^(token|slug|s)\s*=\s*([a-zA-Z0-9_-]+)/);

      if (tokenMatch) {
        code = tokenMatch[2]; // Group 2 is the value
      } else if (content.startsWith('http')) {
        // 2.2 Try to parse as URL to get path slug
        const url = new URL(content);

        // Check path segments
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
          const lastPath = pathParts[pathParts.length - 1];
          // Simple heuristic: if last path part is long enough, assume it's slug
          if (lastPath && lastPath.length >= 8) {
            code = lastPath;
          }
        }

        // Check hash params (e.g. /#/pages/...?token=...)
        if (url.hash) {
          const hashToken = url.hash.match(
            /[?&](token|slug|s)\s*=\s*([a-zA-Z0-9_-]+)/,
          );
          if (hashToken) {
            code = hashToken[2];
          }
        }
      } else {
        // 2.3 Fallback: If code has spaces (e.g. "SLUG 加价100"), try to extract the slug part
        // Assume slug is a word with at least 8 chars (standard nanoid is 8+)
        const possibleSlug = content.match(/\b[a-zA-Z0-9_-]{8,}\b/);
        if (possibleSlug) {
          code = possibleSlug[0];
        } else {
          // Maybe it is just the first word?
          const firstWord = content.split(/[\s,，.。;；]+/)[0];
          if (firstWord && firstWord.length >= 6) {
            // Relaxed length check
            code = firstWord;
          }
        }
      }
    } catch {
      // Not a valid URL, treat content as raw slug
    }

    // Clean up code if it picked up the markup keyword by mistake (unlikely due to regex order but possible)
    if (code.match(/^(加价|markup)$/i)) {
      code = ''; // Invalid code
    }

    return { code, markupOptions };
  }
}
