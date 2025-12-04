import { marked, Renderer, Tokens } from 'marked';

export class MarkdownToConfluenceConverter {
  private renderer: Renderer;

  constructor() {
    this.renderer = this.createConfluenceRenderer();
  }

  convert(markdown: string): string {
    // Normalize line endings - convert literal \n to actual newlines
    let content = markdown.replace(/\\n/g, '\n');

    // Remove YAML frontmatter
    content = content.replace(/^---[\s\S]*?---\n*/m, '');

    // Configure marked with our custom renderer
    marked.setOptions({
      renderer: this.renderer,
      gfm: true,
      breaks: false,
    });

    let html = marked.parse(content) as string;

    // Clean up extra newlines
    html = html.replace(/\n{3,}/g, '\n\n');

    return html.trim();
  }

  private createConfluenceRenderer(): Renderer {
    const renderer = new Renderer();

    // Headings
    renderer.heading = ({ text, depth }: Tokens.Heading): string => {
      return `<h${depth}>${text}</h${depth}>\n`;
    };

    // Paragraphs - need to parse inline tokens
    renderer.paragraph = (token: Tokens.Paragraph): string => {
      const content = this.parseInlineTokens(token.tokens);
      return `<p>${content}</p>\n`;
    };

    // Bold
    renderer.strong = ({ text }: Tokens.Strong): string => {
      return `<strong>${text}</strong>`;
    };

    // Italic
    renderer.em = ({ text }: Tokens.Em): string => {
      return `<em>${text}</em>`;
    };

    // Inline code
    renderer.codespan = ({ text }: Tokens.Codespan): string => {
      return `<code>${text}</code>`;
    };

    // Code blocks
    renderer.code = ({ text, lang }: Tokens.Code): string => {
      const language = lang || 'text';
      const escapedCode = this.escapeForCdata(text);
      return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${language}</ac:parameter><ac:plain-text-body><![CDATA[${escapedCode}]]></ac:plain-text-body></ac:structured-macro>\n`;
    };

    // Lists - marked passes the token, we need to render items ourselves
    renderer.list = (token: Tokens.List): string => {
      const tag = token.ordered ? 'ol' : 'ul';
      // Render each list item using the parser
      const itemsHtml = token.items
        .map((item) => renderer.listitem(item))
        .join('');
      return `<${tag}>\n${itemsHtml}</${tag}>\n`;
    };

    // List items
    renderer.listitem = (item: Tokens.ListItem): string => {
      // Parse the item's tokens to get the rendered content
      let content = '';
      for (const token of item.tokens) {
        if (token.type === 'text') {
          // Text token may have inline tokens
          const textToken = token as Tokens.Text & { tokens?: Tokens.Generic[] };
          if (textToken.tokens) {
            content += this.parseInlineTokens(textToken.tokens);
          } else {
            // Parse raw text that might still contain markdown
            content += this.parseMarkdownText(textToken.text);
          }
        } else if (token.type === 'paragraph') {
          // Don't wrap in <p> for list items, but parse inline tokens
          const paraToken = token as Tokens.Paragraph;
          content += this.parseInlineTokens(paraToken.tokens);
        } else if (token.type === 'list') {
          // Nested list - recursively render
          content += renderer.list(token as Tokens.List);
        } else {
          // For other tokens, use marked's parser
          content += marked.parser([token]);
        }
      }
      return `<li>${content}</li>\n`;
    };

    // Links - YouTube links use Smart Link embed format
    renderer.link = ({ href, text }: Tokens.Link): string => {
      const youtubeMatch = href.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
      );
      if (youtubeMatch) {
        // Confluence Cloud Smart Link embed format
        return `<a href="${href}" data-card-appearance="embed">${href}</a>`;
      }
      return `<a href="${href}">${text}</a>`;
    };

    // Images
    renderer.image = ({ href }: Tokens.Image): string => {
      if (href.startsWith('./screenshots/')) {
        const filename = href.replace('./screenshots/', '');
        return `<ac:image ac:thumbnail="true" ac:width="600"><ri:attachment ri:filename="${filename}"/></ac:image>`;
      }
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return `<ac:image><ri:url ri:value="${href}"/></ac:image>`;
      }
      // Local file reference
      return `<ac:image ac:thumbnail="true" ac:width="600"><ri:attachment ri:filename="${href}"/></ac:image>`;
    };

    // Horizontal rule
    renderer.hr = (): string => {
      return '<hr/>\n';
    };

    // Blockquote
    renderer.blockquote = ({ text }: Tokens.Blockquote): string => {
      return `<blockquote>${text}</blockquote>\n`;
    };

    // Line break
    renderer.br = (): string => {
      return '<br/>';
    };

    // Delete (strikethrough)
    renderer.del = ({ text }: Tokens.Del): string => {
      return `<del>${text}</del>`;
    };

    // Table
    renderer.table = (token: Tokens.Table): string => {
      let headerHtml = '<tr>';
      for (const cell of token.header) {
        headerHtml += `<th>${cell.text}</th>`;
      }
      headerHtml += '</tr>\n';

      let bodyHtml = '';
      for (const row of token.rows) {
        bodyHtml += '<tr>';
        for (const cell of row) {
          bodyHtml += `<td>${cell.text}</td>`;
        }
        bodyHtml += '</tr>\n';
      }

      return `<table><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table>\n`;
    };

    renderer.tablerow = ({ text }: Tokens.TableRow): string => {
      return `<tr>${text}</tr>\n`;
    };

    renderer.tablecell = ({ text, header }: Tokens.TableCell): string => {
      const tag = header ? 'th' : 'td';
      return `<${tag}>${text}</${tag}>`;
    };

    return renderer;
  }

  private escapeForCdata(text: string): string {
    // CDATA sections cannot contain "]]>" so we need to escape it
    return text.replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  private parseMarkdownText(text: string): string {
    // Parse remaining markdown syntax in raw text
    // Bold: **text** or __text__
    let result = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    result = result.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Inline code: `text`
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    return result;
  }

  private parseInlineTokens(tokens: Tokens.Generic[] | undefined): string {
    if (!tokens) return '';

    let result = '';
    for (const token of tokens) {
      switch (token.type) {
        case 'text':
          // Parse any remaining markdown syntax in text
          result += this.parseMarkdownText((token as Tokens.Text).text);
          break;
        case 'strong':
          result += `<strong>${this.parseInlineTokens((token as Tokens.Strong).tokens)}</strong>`;
          break;
        case 'em':
          result += `<em>${this.parseInlineTokens((token as Tokens.Em).tokens)}</em>`;
          break;
        case 'codespan':
          result += `<code>${(token as Tokens.Codespan).text}</code>`;
          break;
        case 'link': {
          const linkToken = token as Tokens.Link;
          const href = linkToken.href;
          const text = this.parseInlineTokens(linkToken.tokens);

          // YouTube links use Smart Link embed format
          const youtubeMatch = href.match(
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
          );
          if (youtubeMatch) {
            result += `<a href="${href}" data-card-appearance="embed">${href}</a>`;
          } else {
            result += `<a href="${href}">${text}</a>`;
          }
          break;
        }
        case 'image': {
          const imgToken = token as Tokens.Image;
          const href = imgToken.href;
          if (href.startsWith('./screenshots/')) {
            const filename = href.replace('./screenshots/', '');
            result += `<ac:image ac:thumbnail="true" ac:width="600"><ri:attachment ri:filename="${filename}"/></ac:image>`;
          } else if (href.startsWith('http://') || href.startsWith('https://')) {
            result += `<ac:image><ri:url ri:value="${href}"/></ac:image>`;
          } else {
            result += `<ac:image ac:thumbnail="true" ac:width="600"><ri:attachment ri:filename="${href}"/></ac:image>`;
          }
          break;
        }
        case 'br':
          result += '<br/>';
          break;
        case 'del':
          result += `<del>${this.parseInlineTokens((token as Tokens.Del).tokens)}</del>`;
          break;
        default:
          // Fallback: try to get text property and parse markdown
          if ('text' in token) {
            result += this.parseMarkdownText((token as unknown as { text: string }).text);
          }
      }
    }
    return result;
  }

  convertToIndexPage(
    playlistTitle: string,
    videos: Array<{
      title: string;
      pageId: string;
      pageTitle: string;
      videoId?: string;
      summary?: string;
    }>
  ): string {
    let content = `<h1>${this.escapeHtml(playlistTitle)}</h1>\n\n`;
    content += `<p>총 ${videos.length}개 영상</p>\n\n`;

    content += '<table>\n';
    content += '<thead><tr><th>영상</th><th>요약</th><th>하위 페이지</th></tr></thead>\n';
    content += '<tbody>\n';

    for (const video of videos) {
      content += '<tr>';
      // YouTube embed using Smart Link format
      if (video.videoId) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
        content += `<td><a href="${youtubeUrl}" data-card-appearance="embed">${youtubeUrl}</a></td>`;
      } else {
        content += `<td>${this.escapeHtml(video.title)}</td>`;
      }
      // Summary column
      content += `<td>${video.summary ? this.escapeHtml(video.summary) : ''}</td>`;
      // Page link column
      content += `<td><ac:link><ri:page ri:content-id="${video.pageId}" ri:content-title="${this.escapeHtml(video.pageTitle)}"/><ac:plain-text-link-body><![CDATA[${this.escapeHtml(video.pageTitle)}]]></ac:plain-text-link-body></ac:link></td>`;
      content += '</tr>\n';
    }

    content += '</tbody>\n';
    content += '</table>';

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
