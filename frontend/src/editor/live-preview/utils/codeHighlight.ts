import { createLowlight, common } from 'lowlight';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageFn = any;

export interface HighlightResult {
  html: string;
  language: string;
  detected: boolean;
}

const lowlight = createLowlight(common);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hastToHtml(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return escapeHtml(node.value || '');
  if (node.type === 'element') {
    const tag = node.tagName;
    const classes = node.properties?.className?.join(' ') || '';
    const classAttr = classes ? ` class="${classes}"` : '';
    const children = (node.children || []).map(hastToHtml).join('');
    return `<${tag}${classAttr}>${children}</${tag}>`;
  }
  if (node.type === 'root') return (node.children || []).map(hastToHtml).join('');
  return '';
}

/** No-op kept for API compatibility — lowlight is initialized at module load. */
export async function initHighlighter(): Promise<boolean> {
  return true;
}

export function isHighlighterAvailable(): boolean {
  return true;
}

export function highlightCode(code: string, lang?: string): HighlightResult {
  if (!code) {
    return { html: '', language: lang || 'text', detected: false };
  }

  if (lang) {
    if (lowlight.registered(lang)) {
      const result = lowlight.highlight(lang, code);
      return { html: hastToHtml(result), language: lang, detected: false };
    }
    return { html: escapeHtml(code), language: lang, detected: false };
  }

  const result = lowlight.highlightAuto(code);
  return {
    html: hastToHtml(result),
    language: result.data?.language || 'text',
    detected: true,
  };
}

export function registerLanguage(name: string, syntax: LanguageFn): void {
  lowlight.register({ [name]: syntax });
}

export function highlightCodeHast(code: string, lang?: string): any | null {
  if (!code) return null;
  if (lang && lowlight.registered(lang)) return lowlight.highlight(lang, code);
  if (!lang) return lowlight.highlightAuto(code);
  return null;
}

export function isLanguageRegistered(name: string): boolean {
  return lowlight.registered(name);
}
