import { describe, it, expect } from 'vitest';
import { MarkdownToConfluenceConverter } from './converter.js';

describe('MarkdownToConfluenceConverter', () => {
  const converter = new MarkdownToConfluenceConverter();

  describe('basic formatting', () => {
    it('converts headings', () => {
      const md = '# Heading 1\n## Heading 2\n### Heading 3';
      const result = converter.convert(md);
      expect(result).toContain('<h1>Heading 1</h1>');
      expect(result).toContain('<h2>Heading 2</h2>');
      expect(result).toContain('<h3>Heading 3</h3>');
    });

    it('converts bold text', () => {
      const md = 'This is **bold** text';
      const result = converter.convert(md);
      expect(result).toContain('<strong>bold</strong>');
    });

    it('converts italic text', () => {
      const md = 'This is *italic* text';
      const result = converter.convert(md);
      expect(result).toContain('<em>italic</em>');
    });

    it('converts inline code', () => {
      const md = 'Use `code` here';
      const result = converter.convert(md);
      expect(result).toContain('<code>code</code>');
    });

    it('converts code blocks', () => {
      const md = '```python\nprint("hello")\n```';
      const result = converter.convert(md);
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">python</ac:parameter>');
      expect(result).toContain('print("hello")');
    });

    it('converts horizontal rules', () => {
      const md = 'Before\n\n---\n\nAfter';
      const result = converter.convert(md);
      expect(result).toContain('<hr/>');
    });
  });

  describe('lists', () => {
    it('converts unordered lists', () => {
      const md = '- Item 1\n- Item 2\n- Item 3';
      const result = converter.convert(md);
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>Item 1</li>');
      expect(result).toContain('<li>Item 2</li>');
      expect(result).toContain('<li>Item 3</li>');
      expect(result).toContain('</ul>');
    });

    it('converts ordered lists', () => {
      const md = '1. First\n2. Second\n3. Third';
      const result = converter.convert(md);
      expect(result).toContain('<ol>');
      expect(result).toContain('<li>First</li>');
      expect(result).toContain('<li>Second</li>');
      expect(result).toContain('</ol>');
    });

    it('converts nested lists', () => {
      const md = '- Parent\n  - Child 1\n  - Child 2\n- Another parent';
      const result = converter.convert(md);
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>Parent');
      expect(result).toContain('<li>Child 1</li>');
      expect(result).toContain('<li>Child 2</li>');
    });

    it('converts bold inside list items', () => {
      const md = '- **Bold item**\n- Normal item';
      const result = converter.convert(md);
      expect(result).toContain('<li><strong>Bold item</strong></li>');
      expect(result).toContain('<li>Normal item</li>');
    });

    it('converts links inside list items', () => {
      const md = '- [Link text](https://example.com)\n- Normal item';
      const result = converter.convert(md);
      expect(result).toContain('<li><a href="https://example.com">Link text</a></li>');
    });
  });

  describe('links', () => {
    it('converts regular links', () => {
      const md = '[Example](https://example.com)';
      const result = converter.convert(md);
      expect(result).toContain('<a href="https://example.com">Example</a>');
    });

    it('converts YouTube links to embed widget', () => {
      const md = '[Watch Video](https://www.youtube.com/watch?v=abc123def45)';
      const result = converter.convert(md);
      expect(result).toContain('<ac:structured-macro ac:name="widget"');
      expect(result).toContain('https://www.youtube.com/watch?v=abc123def45');
      expect(result).toContain('<a href="https://www.youtube.com/watch?v=abc123def45">Watch Video</a>');
    });

    it('converts youtu.be short links to embed widget', () => {
      const md = '[Video](https://youtu.be/abc123def45)';
      const result = converter.convert(md);
      expect(result).toContain('<ac:structured-macro ac:name="widget"');
      expect(result).toContain('abc123def45');
    });
  });

  describe('images', () => {
    it('converts local screenshot images', () => {
      const md = '![Alt text](./screenshots/00-30.png)';
      const result = converter.convert(md);
      expect(result).toContain('<ac:image ac:thumbnail="true" ac:width="600">');
      expect(result).toContain('<ri:attachment ri:filename="00-30.png"/>');
    });

    it('converts external images', () => {
      const md = '![Alt text](https://example.com/image.png)';
      const result = converter.convert(md);
      expect(result).toContain('<ac:image>');
      expect(result).toContain('<ri:url ri:value="https://example.com/image.png"/>');
    });
  });

  describe('frontmatter', () => {
    it('removes YAML frontmatter', () => {
      const md = '---\ntitle: "Test"\ndate: "2024-01-01"\n---\n\n# Content';
      const result = converter.convert(md);
      expect(result).not.toContain('title: "Test"');
      expect(result).not.toContain('---');
      expect(result).toContain('<h1>Content</h1>');
    });
  });

  describe('special handling', () => {
    it('normalizes literal \\n to newlines', () => {
      const md = 'Line 1\\nLine 2';
      const result = converter.convert(md);
      // After normalization, should be treated as separate lines or paragraph
      expect(result).not.toContain('\\n');
    });

    it('handles complex nested content', () => {
      const md = `## Summary

- **Point 1**: Description
  - Sub-point A
  - Sub-point B
- **Point 2**: Another description

### Details

1. First step
2. Second step`;

      const result = converter.convert(md);
      expect(result).toContain('<h2>Summary</h2>');
      expect(result).toContain('<strong>Point 1</strong>');
      expect(result).toContain('<li>Sub-point A</li>');
      expect(result).toContain('<h3>Details</h3>');
      expect(result).toContain('<ol>');
    });
  });

  describe('convertToIndexPage', () => {
    it('creates index page with video links', () => {
      const videos = [
        { title: 'Video 1', pageId: '123' },
        { title: 'Video 2', pageId: '456', description: 'A description' },
      ];
      const result = converter.convertToIndexPage('My Playlist', videos);

      expect(result).toContain('<h1>My Playlist</h1>');
      expect(result).toContain('총 2개 영상');
      expect(result).toContain('ri:content-id="123"');
      expect(result).toContain('Video 1');
      expect(result).toContain('ri:content-id="456"');
      expect(result).toContain('A description');
    });

    it('escapes HTML in titles', () => {
      const videos = [{ title: '<script>alert("xss")</script>', pageId: '123' }];
      const result = converter.convertToIndexPage('Playlist', videos);

      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });
  });
});
