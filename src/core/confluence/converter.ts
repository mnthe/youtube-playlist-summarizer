export class MarkdownToConfluenceConverter {
  convert(markdown: string): string {
    let html = markdown;

    // Normalize line endings - convert literal \n to actual newlines
    html = html.replace(/\\n/g, '\n');

    // Remove YAML frontmatter
    html = html.replace(/^---[\s\S]*?---\n*/m, '');

    // Convert code blocks first (before other processing)
    html = html.replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      (_, lang, code) => {
        const language = lang || 'text';
        return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${language}</ac:parameter><ac:plain-text-body><![CDATA[${code.trim()}]]></ac:plain-text-body></ac:structured-macro>`;
      }
    );

    // Convert headers (h1-h6)
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Convert images to Confluence attachment format
    html = html.replace(
      /!\[([^\]]*)\]\(\.\/screenshots\/([^)]+)\)/g,
      '<ac:image ac:thumbnail="true" ac:width="600"><ri:attachment ri:filename="$2"/></ac:image>'
    );

    // Convert external images
    html = html.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
      '<ac:image><ri:url ri:value="$2"/></ac:image>'
    );

    // Convert links
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2">$1</a>'
    );

    // Convert bold (before italic to handle **text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Convert italic
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');

    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert horizontal rules
    html = html.replace(/^---$/gm, '<hr/>');
    html = html.replace(/^\*\*\*$/gm, '<hr/>');

    // Convert lists (with nested support)
    html = this.convertLists(html);

    // Convert paragraphs
    html = this.convertParagraphs(html);

    // Clean up extra newlines
    html = html.replace(/\n{3,}/g, '\n\n');

    return html.trim();
  }

  private convertLists(html: string): string {
    const lines = html.split('\n');
    const result: string[] = [];
    const listStack: Array<{ type: 'ul' | 'ol'; indent: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match unordered list item: "  - item" or "  * item"
      // Also handle various indentation styles (spaces, tabs)
      const ulMatch = line.match(/^(\s*)([-*•])\s+(.+)$/);
      // Match ordered list item: "  1. item" or "  1) item"
      const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);

      if (ulMatch || olMatch) {
        // Normalize indent: treat every 2-4 chars as one level
        const rawIndent = (ulMatch || olMatch)![1].length;
        const indent = Math.floor(rawIndent / 2) * 2; // Normalize to even numbers
        const content = ulMatch ? ulMatch[3] : olMatch![3];
        const listType = ulMatch ? 'ul' : 'ol';

        // Close lists that are more indented than current
        while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
          const closed = listStack.pop()!;
          result.push(`</${closed.type}>`);
        }

        // If same indent but different list type, close and open new
        if (listStack.length > 0 && listStack[listStack.length - 1].indent === indent) {
          if (listStack[listStack.length - 1].type !== listType) {
            const closed = listStack.pop()!;
            result.push(`</${closed.type}>`);
            result.push(`<${listType}>`);
            listStack.push({ type: listType, indent });
          }
        }

        // Open new list if needed
        if (listStack.length === 0 || listStack[listStack.length - 1].indent < indent) {
          result.push(`<${listType}>`);
          listStack.push({ type: listType, indent });
        }

        result.push(`<li>${content}</li>`);
      } else {
        // Check if this is a continuation of a list item (non-empty, indented, no list marker)
        const continuationMatch = line.match(/^(\s{2,})([^-*•\d\s].*)$/);
        if (continuationMatch && listStack.length > 0) {
          // Append to previous list item if exists
          const lastIndex = result.length - 1;
          if (lastIndex >= 0 && result[lastIndex].startsWith('<li>')) {
            result[lastIndex] = result[lastIndex].replace('</li>', ` ${continuationMatch[2].trim()}</li>`);
            continue;
          }
        }

        // Not a list item - close all open lists
        while (listStack.length > 0) {
          const closed = listStack.pop()!;
          result.push(`</${closed.type}>`);
        }
        result.push(line);
      }
    }

    // Close any remaining open lists
    while (listStack.length > 0) {
      const closed = listStack.pop()!;
      result.push(`</${closed.type}>`);
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

      // Skip if already HTML, empty, or special element
      if (
        trimmed === '' ||
        trimmed.startsWith('<h') ||
        trimmed.startsWith('</h') ||
        trimmed.startsWith('<ul') ||
        trimmed.startsWith('</ul') ||
        trimmed.startsWith('<ol') ||
        trimmed.startsWith('</ol') ||
        trimmed.startsWith('<li') ||
        trimmed.startsWith('</li') ||
        trimmed.startsWith('<hr') ||
        trimmed.startsWith('<p>') ||
        trimmed.startsWith('</p>') ||
        trimmed.startsWith('<ac:') ||
        trimmed.startsWith('<a ') ||
        trimmed.startsWith('</a>')
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
