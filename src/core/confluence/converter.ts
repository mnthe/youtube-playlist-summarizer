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

    // Replace YouTube embed placeholders
    html = html.replace(
      /___YOUTUBE_EMBED_([a-zA-Z0-9_-]{11})___/g,
      '<ac:structured-macro ac:name="widget" ac:schema-version="1"><ac:parameter ac:name="url">https://www.youtube.com/watch?v=$1</ac:parameter><ac:parameter ac:name="width">560</ac:parameter><ac:parameter ac:name="height">315</ac:parameter></ac:structured-macro>'
    );

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
            content += textToken.text;
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

    // Links - with YouTube embed support
    renderer.link = ({ href, text }: Tokens.Link): string => {
      // Check if this is a YouTube link that should be embedded
      const youtubeMatch = href.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
      );

      if (youtubeMatch) {
        const videoId = youtubeMatch[1];
        // Return both embed and link
        return `<ac:structured-macro ac:name="widget" ac:schema-version="1"><ac:parameter ac:name="url">https://www.youtube.com/watch?v=${videoId}</ac:parameter><ac:parameter ac:name="width">560</ac:parameter><ac:parameter ac:name="height">315</ac:parameter></ac:structured-macro><p><a href="${href}">${text}</a></p>`;
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

  private parseInlineTokens(tokens: Tokens.Generic[] | undefined): string {
    if (!tokens) return '';

    let result = '';
    for (const token of tokens) {
      switch (token.type) {
        case 'text':
          result += (token as Tokens.Text).text;
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

          // Check for YouTube embed
          const youtubeMatch = href.match(
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
          );
          if (youtubeMatch) {
            const videoId = youtubeMatch[1];
            // Use placeholder that will be replaced after paragraph processing
            result += `___YOUTUBE_EMBED_${videoId}___ <a href="${href}">${text}</a>`;
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
          // Fallback: try to get text property
          if ('text' in token) {
            result += (token as unknown as { text: string }).text;
          }
      }
    }
    return result;
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
