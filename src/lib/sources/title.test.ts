import { describe, expect, it } from 'vitest';
import { extractTitle, normalizeTitle, titlesMatch } from './title';

describe('extractTitle', () => {
  it('reads the first <title>, case-insensitively and across lines', () => {
    expect(extractTitle('<html><HEAD><TITLE lang="en">\n  Hello\n   World \n</TITLE></HEAD>')).toBe('Hello World');
    expect(extractTitle('<title>A</title><title>B</title>')).toBe('A');
  });

  it('decodes named, decimal and hex entities', () => {
    const html = '<title>Tom &amp; Jerry &lt;3 &quot;x&quot; it&#39;s&apos;&nbsp;ok &#20013;&#x6587; &#x1F600;</title>';
    expect(extractTitle(html)).toBe('Tom & Jerry <3 "x" it\'s\' ok 中文 \u{1F600}');
  });

  it('does not double-decode and leaves unknown or invalid entities alone', () => {
    expect(extractTitle('<title>&amp;lt; &foo; &#99999999;</title>')).toBe('&lt; &foo; &#99999999;');
  });

  it('falls back to og:title with any attribute order and quote style', () => {
    expect(extractTitle('<meta property="og:title" content="Page One">')).toBe('Page One');
    expect(extractTitle("<meta content='Page &amp; Two' property='og:title'/>")).toBe('Page & Two');
    expect(extractTitle('<META NAME="og:title" CONTENT="Page Three">')).toBe('Page Three');
  });

  it('prefers <title> over og:title but skips an empty <title>', () => {
    const og = '<meta property="og:title" content="OG">';
    expect(extractTitle(`${og}<title>Real</title>`)).toBe('Real');
    expect(extractTitle(`${og}<title>  </title>`)).toBe('OG');
  });

  it('returns null when nothing is found', () => {
    expect(extractTitle('<html><body>hi</body></html>')).toBeNull();
    expect(extractTitle('<meta property="og:description" content="x">')).toBeNull();
  });

  it('caps the result at 300 chars', () => {
    const t = extractTitle(`<title>${'a'.repeat(500)}</title>`);
    expect(t).toHaveLength(300);
  });
});

describe('normalizeTitle', () => {
  it('applies NFKC, lowercases, strips punctuation and symbols, collapses whitespace', () => {
    expect(normalizeTitle('  Ｈello,   World! | “Quoted” – ok ')).toBe('hello world quoted ok');
    expect(normalizeTitle('36氪：AI 学习')).toBe('36氪 ai 学习');
    expect(normalizeTitle('!!! --- ***')).toBe('');
  });
});

describe('titlesMatch', () => {
  it('matches by containment', () => {
    expect(titlesMatch('Notion', 'Notion – The all-in-one workspace for your notes')).toBe(true);
    expect(titlesMatch('Notion – The all-in-one workspace for your notes', 'notion')).toBe(true);
  });

  it('matches CJK titles with different separators', () => {
    expect(titlesMatch('36氪：AI 学习陪练赛道融资', 'AI学习陪练赛道融资 | 36氪')).toBe(true);
  });

  it('rejects unrelated titles', () => {
    expect(titlesMatch('OpenAI pricing', 'Example Domain')).toBe(false);
  });

  it('is false when either side is empty after normalization', () => {
    expect(titlesMatch('', 'Something')).toBe(false);
    expect(titlesMatch('Something', '!!!')).toBe(false);
  });

  it('requires a long enough shorter side for containment', () => {
    expect(titlesMatch('AI', 'AI news today')).toBe(false);
    expect(titlesMatch('Go', 'Go is great')).toBe(false);
    expect(titlesMatch('学习', '在线学习平台')).toBe(true);
    expect(titlesMatch('学', '在线学习平台')).toBe(false);
  });

  it('uses token overlap with a 0.6 threshold when not contained', () => {
    expect(titlesMatch('Stripe payments API reference', 'API reference | Stripe docs')).toBe(true);
    expect(titlesMatch('Stripe payments API reference', 'Stripe news')).toBe(false);
    expect(titlesMatch('alpha beta gamma delta', 'delta gamma epsilon zeta eta theta')).toBe(false);
  });
});
