export const extractImportCode = (input: string) => {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const queryMatch = raw.match(/[?&](token|slug|s)=([a-zA-Z0-9_-]+)/i);
  if (queryMatch?.[2]) return queryMatch[2];

  const directMatch = raw.match(/^[a-zA-Z0-9_-]{5,64}$/);
  if (directMatch?.[0]) return directMatch[0];

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const fromSearch =
        url.searchParams.get('slug') ||
        url.searchParams.get('s') ||
        url.searchParams.get('token') ||
        '';
      if (fromSearch) return fromSearch;

      const pathSeg = url.pathname.split('/').filter(Boolean).pop() || '';
      if (/^[a-zA-Z0-9_-]{5,64}$/.test(pathSeg)) return pathSeg;

      if (url.hash) {
        const hashQueryMatch = url.hash.match(/[?&](slug|s|token)=([a-zA-Z0-9_-]+)/i);
        if (hashQueryMatch?.[2]) return hashQueryMatch[2];

        const hashPathMatch = url.hash.match(/\/(?:s\/)?([a-zA-Z0-9_-]{5,64})\/?$/i);
        if (hashPathMatch?.[1]) return hashPathMatch[1];
      }
    } catch {
      return '';
    }
  }

  const loosePathMatch = raw.match(/\/(?:s\/)?([a-zA-Z0-9_-]{5,64})\/?$/i);
  if (loosePathMatch?.[1]) return loosePathMatch[1];

  return '';
};
