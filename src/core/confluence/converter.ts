export class MarkdownToConfluenceConverter {
  convert(markdown: string): string {
    let html = markdown;

    // Remove YAML frontmatter
    html = html.replace(/^---[\s\S]*?---\n*/m, '');

    // Convert headers (h1-h6)
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Convert images to Confluence attachment format
    // ![alt](./screenshots/filename.png) -> <ac:image><ri:attachment ri:filename="filename.png"/></ac:image>
    html = html.replace(
      /!\[([^\]]*)\]\(\.\/screenshots\/([^)]+)\)/g,
      '<ac:image ac:thumbnail="true" ac:width="600"><ri:attachment ri:filename="$2"/></ac:image>'
    );

    // Convert external images
    // ![alt](https://...) -> <ac:image><ri:url ri:value="..."/></ac:image>
    html = html.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
      '<ac:image><ri:url ri:value="$2"/></ac:image>'
    );

    // Convert links
    // [text](url) -> <a href="url">text</a>
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2">$1</a>'
    );

    // Convert bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Convert italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert code blocks
    html = html.replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      (_, lang, code) => {
        const language = lang || 'text';
        return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${language}</ac:parameter><ac:plain-text-body><![CDATA[${code.trim()}]]></ac:plain-text-body></ac:structured-macro>`;
      }
    );

    // Convert unordered lists
    html = this.convertUnorderedLists(html);

    // Convert ordered lists
    html = this.convertOrderedLists(html);

    // Convert horizontal rules
    html = html.replace(/^---$/gm, '<hr/>');
    html = html.replace(/^\*\*\*$/gm, '<hr/>');

    // Convert paragraphs (lines that aren't already HTML)
    html = this.convertParagraphs(html);

    // Clean up extra newlines
    html = html.replace(/\n{3,}/g, '\n\n');

    return html.trim();
  }

  private convertUnorderedLists(html: string): string {
    const lines = html.split('\n');
    const result: string[] = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\s*)[-*]\s+(.+)$/);

      if (match) {
        if (!inList) {
          result.push('<ul>');
          inList = true;
        }
        result.push(`<li>${match[2]}</li>`);
      } else {
        if (inList && line.trim() !== '') {
          result.push('</ul>');
          inList = false;
        }
        result.push(line);
      }
    }

    if (inList) {
      result.push('</ul>');
    }

    return result.join('\n');
  }

  private convertOrderedLists(html: string): string {
    const lines = html.split('\n');
    const result: string[] = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\s*)\d+\.\s+(.+)$/);

      if (match) {
        if (!inList) {
          result.push('<ol>');
          inList = true;
        }
        result.push(`<li>${match[2]}</li>`);
      } else {
        if (inList && line.trim() !== '') {
          result.push('</ol>');
          inList = false;
        }
        result.push(line);
      }
    }

    if (inList) {
      result.push('</ol>');
    }

    return result.join('\n');
  }

  private convertParagraphs(html: string): string {
    const lines = html.split('\n');
    const result: string[] = [];
    let paragraphLines: string[] = [];

    const flushParagraph = () => {
      if (paragraphLines.length > 0) {
        const text = paragraphLines.join(' ').trim();
        if (text) {
          result.push(`<p>${text}</p>`);
        }
        paragraphLines = [];
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip if already HTML or empty
      if (
        trimmed === '' ||
        trimmed.startsWith('<') ||
        trimmed.startsWith('</')
      ) {
        flushParagraph();
        if (trimmed !== '') {
          result.push(line);
        }
      } else {
        paragraphLines.push(trimmed);
      }
    }

    flushParagraph();

    return result.join('\n');
  }

  convertToIndexPage(
    playlistTitle: string,
    videos: Array<{ title: string; pageId: string; description?: string }>
  ): string {
    let content = `<h1>${this.escapeHtml(playlistTitle)}</h1>\n\n`;
    content += `<p>총 ${videos.length}개 영상</p>\n\n`;
    content += '<ul>\n';

    for (const video of videos) {
      content += `<li><ac:link><ri:page ri:content-id="${video.pageId}"/><ac:plain-text-link-body><![CDATA[${this.escapeHtml(video.title)}]]></ac:plain-text-link-body></ac:link>`;
      if (video.description) {
        content += ` - ${this.escapeHtml(video.description)}`;
      }
      content += '</li>\n';
    }

    content += '</ul>';

    return content;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
