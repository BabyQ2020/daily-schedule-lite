import { render } from '@testing-library/react';

import { HighlightedText, makeSnippet, splitHighlight } from './highlight';

describe('splitHighlight', () => {
  it('按关键词切分并标记命中片段', () => {
    expect(splitHighlight('推进登录模块', '登录')).toEqual([
      { text: '推进', match: false },
      { text: '登录', match: true },
      { text: '模块', match: false },
    ]);
  });

  it('大小写不敏感地匹配，但保留原始文本', () => {
    expect(splitHighlight('Fix Login Bug', 'login')).toEqual([
      { text: 'Fix ', match: false },
      { text: 'Login', match: true },
      { text: ' Bug', match: false },
    ]);
  });

  it('多次出现时全部标记', () => {
    const parts = splitHighlight('日志 日志', '日志');
    expect(parts.filter((part) => part.match)).toHaveLength(2);
  });

  it('关键词为空时原样返回', () => {
    expect(splitHighlight('推进登录模块', '   ')).toEqual([{ text: '推进登录模块', match: false }]);
  });
});

describe('makeSnippet', () => {
  it('短文本原样返回（压缩空白）', () => {
    expect(makeSnippet('  今天  修好了登录  ', '登录')).toBe('今天 修好了登录');
  });

  it('命中位置靠后时以关键词为中心开窗', () => {
    const text = `${'铺垫'.repeat(60)}关键结论在这里之后还有很多内容${'收尾'.repeat(60)}`;
    const snippet = makeSnippet(text, '关键结论', 60);
    expect(snippet).toContain('关键结论');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(62);
  });

  it('未命中时截断并加省略号', () => {
    const snippet = makeSnippet('a'.repeat(200), '找不到', 20);
    expect(snippet).toBe(`${'a'.repeat(20)}…`);
  });
});

describe('HighlightedText', () => {
  it('命中片段用 mark 渲染', () => {
    const { container } = render(<HighlightedText text="推进登录模块" keyword="登录" />);
    const marks = container.querySelectorAll('mark.search-hit');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('登录');
    expect(container.textContent).toBe('推进登录模块');
  });
});
