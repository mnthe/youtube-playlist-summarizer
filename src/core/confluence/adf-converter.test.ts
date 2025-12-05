import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownToADFConverter, ADFDocument, ADFNode } from './adf-converter.js';

describe('MarkdownToADFConverter', () => {
  let converter: MarkdownToADFConverter;

  beforeEach(() => {
    converter = new MarkdownToADFConverter();
  });

  describe('basic structure', () => {
    it('returns valid ADF document structure', () => {
      const md = 'Hello World';
      const result = converter.convert(md);

      expect(result.version).toBe(1);
      expect(result.type).toBe('doc');
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('removes YAML frontmatter', () => {
      const md = `---
title: "Test"
---

Hello World`;
      const result = converter.convert(md);
      const json = converter.toJsonString(result);

      expect(json).not.toContain('title');
      expect(json).not.toContain('---');
    });
  });

  describe('headings', () => {
    it('converts headings with correct level', () => {
      const md = '# Heading 1\n\n## Heading 2\n\n### Heading 3';
      const result = converter.convert(md);

      const headings = result.content.filter((n) => n.type === 'heading');
      expect(headings).toHaveLength(3);
      expect(headings[0].attrs?.level).toBe(1);
      expect(headings[1].attrs?.level).toBe(2);
      expect(headings[2].attrs?.level).toBe(3);
    });
  });

  describe('paragraphs and text', () => {
    it('converts plain text to paragraph', () => {
      const md = 'Hello World';
      const result = converter.convert(md);

      expect(result.content[0].type).toBe('paragraph');
      expect(result.content[0].content?.[0].type).toBe('text');
      expect(result.content[0].content?.[0].text).toBe('Hello World');
    });

    it('converts bold text with strong mark', () => {
      const md = 'This is **bold** text';
      const result = converter.convert(md);

      const paragraph = result.content[0];
      const boldNode = paragraph.content?.find(
        (n) => n.marks?.some((m) => m.type === 'strong')
      );

      expect(boldNode).toBeDefined();
      expect(boldNode?.text).toBe('bold');
    });

    it('converts italic text with em mark', () => {
      const md = 'This is *italic* text';
      const result = converter.convert(md);

      const paragraph = result.content[0];
      const italicNode = paragraph.content?.find(
        (n) => n.marks?.some((m) => m.type === 'em')
      );

      expect(italicNode).toBeDefined();
      expect(italicNode?.text).toBe('italic');
    });

    it('converts inline code with code mark', () => {
      const md = 'Use `code` here';
      const result = converter.convert(md);

      const paragraph = result.content[0];
      const codeNode = paragraph.content?.find(
        (n) => n.marks?.some((m) => m.type === 'code')
      );

      expect(codeNode).toBeDefined();
      expect(codeNode?.text).toBe('code');
    });
  });

  describe('lists', () => {
    it('converts unordered lists', () => {
      const md = '- Item 1\n- Item 2\n- Item 3';
      const result = converter.convert(md);

      const list = result.content.find((n) => n.type === 'bulletList');
      expect(list).toBeDefined();
      expect(list?.content).toHaveLength(3);
      expect(list?.content?.[0].type).toBe('listItem');
    });

    it('converts ordered lists', () => {
      const md = '1. First\n2. Second\n3. Third';
      const result = converter.convert(md);

      const list = result.content.find((n) => n.type === 'orderedList');
      expect(list).toBeDefined();
      expect(list?.content).toHaveLength(3);
    });
  });

  describe('code blocks', () => {
    it('converts code blocks with language', () => {
      const md = '```javascript\nconsole.log("hello");\n```';
      const result = converter.convert(md);

      const codeBlock = result.content.find((n) => n.type === 'codeBlock');
      expect(codeBlock).toBeDefined();
      expect(codeBlock?.attrs?.language).toBe('javascript');
      expect(codeBlock?.content?.[0].text).toBe('console.log("hello");');
    });

    it('defaults to text language when not specified', () => {
      const md = '```\nsome code\n```';
      const result = converter.convert(md);

      const codeBlock = result.content.find((n) => n.type === 'codeBlock');
      expect(codeBlock?.attrs?.language).toBe('text');
    });
  });

  describe('links', () => {
    it('converts regular links with link mark', () => {
      const md = '[Example](https://example.com)';
      const result = converter.convert(md);

      const paragraph = result.content[0];
      const linkNode = paragraph.content?.find(
        (n) => n.marks?.some((m) => m.type === 'link')
      );

      expect(linkNode).toBeDefined();
      expect(linkNode?.text).toBe('Example');
      const linkMark = linkNode?.marks?.find((m) => m.type === 'link');
      expect(linkMark?.attrs?.href).toBe('https://example.com');
    });

    it('converts YouTube links to embedCard when standalone', () => {
      const md = '[Watch](https://www.youtube.com/watch?v=abc123def45)';
      const result = converter.convert(md);

      // YouTube links in paragraphs become embedCard at document level
      const embedCard = result.content.find((n) => n.type === 'embedCard');

      expect(embedCard).toBeDefined();
      expect(embedCard?.attrs?.url).toBe('https://www.youtube.com/watch?v=abc123def45');
      expect(embedCard?.attrs?.layout).toBe('wide');
      // YouTube 16:9 dimensions are required for proper rendering
      expect(embedCard?.attrs?.width).toBe(100);
      expect(embedCard?.attrs?.originalWidth).toBe(853.34);
      expect(embedCard?.attrs?.originalHeight).toBe(480);
    });

    it('converts youtu.be short links to embedCard when standalone', () => {
      const md = '[Video](https://youtu.be/abc123def45)';
      const result = converter.convert(md);

      const embedCard = result.content.find((n) => n.type === 'embedCard');

      expect(embedCard).toBeDefined();
      expect(embedCard?.attrs?.url).toBe('https://youtu.be/abc123def45');
      expect(embedCard?.attrs?.layout).toBe('wide');
      // YouTube 16:9 dimensions are required for proper rendering
      expect(embedCard?.attrs?.width).toBe(100);
      expect(embedCard?.attrs?.originalWidth).toBe(853.34);
      expect(embedCard?.attrs?.originalHeight).toBe(480);
    });
  });

  describe('tables', () => {
    it('converts markdown tables', () => {
      const md = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;
      const result = converter.convert(md);

      const table = result.content.find((n) => n.type === 'table');
      expect(table).toBeDefined();
      expect(table?.content).toHaveLength(2); // header row + 1 body row

      const headerRow = table?.content?.[0];
      expect(headerRow?.content?.[0].type).toBe('tableHeader');
    });
  });

  describe('blockquote', () => {
    it('converts blockquotes', () => {
      const md = '> This is a quote';
      const result = converter.convert(md);

      const blockquote = result.content.find((n) => n.type === 'blockquote');
      expect(blockquote).toBeDefined();
    });
  });

  describe('horizontal rule', () => {
    it('converts horizontal rules', () => {
      const md = 'Before\n\n---\n\nAfter';
      const result = converter.convert(md);

      const rule = result.content.find((n) => n.type === 'rule');
      expect(rule).toBeDefined();
    });
  });

  describe('convertToIndexPage', () => {
    it('creates index page with correct structure', () => {
      const result = converter.convertToIndexPage('Test Playlist', [
        {
          title: 'Video 1',
          pageId: '123',
          pageUrl: 'https://test.atlassian.net/wiki/pages/123',
          pageTitle: 'Video 1',
          videoId: 'abc123def45',
          summary: 'Summary 1',
        },
        {
          title: 'Video 2',
          pageId: '456',
          pageUrl: 'https://test.atlassian.net/wiki/pages/456',
          pageTitle: 'Video 2',
          summary: 'Summary 2',
        },
      ]);

      expect(result.version).toBe(1);
      expect(result.type).toBe('doc');

      // Check heading
      const heading = result.content.find((n) => n.type === 'heading');
      expect(heading?.content?.[0].text).toBe('Test Playlist');

      // Check table exists
      const table = result.content.find((n) => n.type === 'table');
      expect(table).toBeDefined();

      // Check table has 3 rows (header + 2 videos)
      expect(table?.content).toHaveLength(3);
    });

    it('uses embedCard for YouTube videos in index page', () => {
      const result = converter.convertToIndexPage('Playlist', [
        {
          title: 'Video',
          pageId: '123',
          pageUrl: 'https://test.atlassian.net/wiki/pages/123',
          pageTitle: 'Video',
          videoId: 'abc123def45',
        },
      ]);

      const json = converter.toJsonString(result);
      expect(json).toContain('embedCard');
      expect(json).toContain('"layout":"wide"');
      expect(json).toContain('https://www.youtube.com/watch?v=abc123def45');
      // YouTube 16:9 dimensions are required for proper rendering
      expect(json).toContain('"width":100');
      expect(json).toContain('"originalWidth":853.34');
      expect(json).toContain('"originalHeight":480');
    });
  });

  describe('toJsonString', () => {
    it('serializes ADF document to JSON string', () => {
      const md = 'Hello World';
      const doc = converter.convert(md);
      const json = converter.toJsonString(doc);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(1);
      expect(parsed.type).toBe('doc');
    });
  });

  describe('image URL options', () => {
    it('converts local images to external URLs when baseUrl and pageId provided', () => {
      const md = '![Screenshot](./screenshots/test.png)';
      const result = converter.convert(md, {
        baseUrl: 'https://example.atlassian.net',
        pageId: '12345',
      });

      const mediaSingle = result.content.find((n) => n.type === 'mediaSingle');
      expect(mediaSingle).toBeDefined();

      const media = mediaSingle?.content?.[0];
      expect(media?.attrs?.type).toBe('external');
      expect(media?.attrs?.url).toBe(
        'https://example.atlassian.net/wiki/download/attachments/12345/test.png'
      );
    });

    it('uses placeholder for local images when options not provided', () => {
      const md = '![Screenshot](./screenshots/test.png)';
      const result = converter.convert(md);

      const mediaSingle = result.content.find((n) => n.type === 'mediaSingle');
      const media = mediaSingle?.content?.[0];
      expect(media?.attrs?.type).toBe('file');
      expect(media?.attrs?.id).toBe('test.png');
    });
  });
});
