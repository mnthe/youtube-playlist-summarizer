import { marked, Token, Tokens } from 'marked';

// ADF Node Types
export interface ADFNode {
  type: string;
  content?: ADFNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: ADFMark[];
}

export interface ADFMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ADFDocument {
  version: 1;
  type: 'doc';
  content: ADFNode[];
}

export interface ConvertOptions {
  baseUrl?: string;
  pageId?: string;
  maxImages?: number; // Limit number of images to prevent Confluence API timeout
}

export class MarkdownToADFConverter {
  private options: ConvertOptions = {};
  private imageCount: number = 0;

  convert(markdown: string, options?: ConvertOptions): ADFDocument {
    this.options = options || {};
    this.imageCount = 0; // Reset image counter for each conversion
    // Normalize line endings
    let content = markdown.replace(/\\n/g, '\n');

    // Remove YAML frontmatter
    content = content.replace(/^---[\s\S]*?---\n*/m, '');

    // Parse markdown into tokens
    const tokens = marked.lexer(content);

    // Convert tokens to ADF nodes
    const adfContent = this.convertTokens(tokens);

    return {
      version: 1,
      type: 'doc',
      content: adfContent,
    };
  }

  private convertTokens(tokens: Token[]): ADFNode[] {
    const nodes: ADFNode[] = [];

    for (const token of tokens) {
      const node = this.convertToken(token);
      if (node) {
        if (Array.isArray(node)) {
          nodes.push(...node);
        } else {
          nodes.push(node);
        }
      }
    }

    return nodes;
  }

  private convertToken(token: Token): ADFNode | ADFNode[] | null {
    switch (token.type) {
      case 'heading':
        return this.convertHeading(token as Tokens.Heading);
      case 'paragraph':
        return this.convertParagraph(token as Tokens.Paragraph);
      case 'list':
        return this.convertList(token as Tokens.List);
      case 'code':
        return this.convertCodeBlock(token as Tokens.Code);
      case 'blockquote':
        return this.convertBlockquote(token as Tokens.Blockquote);
      case 'hr':
        return this.convertHorizontalRule();
      case 'table':
        return this.convertTable(token as Tokens.Table);
      case 'space':
        return null;
      default:
        return null;
    }
  }

  private convertHeading(token: Tokens.Heading): ADFNode {
    return {
      type: 'heading',
      attrs: { level: token.depth },
      content: this.convertInlineTokens(token.tokens),
    };
  }

  private convertParagraph(token: Tokens.Paragraph): ADFNode | ADFNode[] | null {
    // Check if paragraph contains only an image
    if (token.tokens.length === 1 && token.tokens[0].type === 'image') {
      const imageNode = this.convertImage(token.tokens[0] as Tokens.Image);
      if (!imageNode) return null; // Image was skipped due to limit
      return imageNode;
    }

    // Check if paragraph contains a YouTube link that should be embedded
    const youtubeEmbed = this.extractYouTubeEmbed(token.tokens);
    if (youtubeEmbed) {
      return youtubeEmbed;
    }

    return {
      type: 'paragraph',
      content: this.convertInlineTokens(token.tokens),
    };
  }

  private extractYouTubeEmbed(tokens: Tokens.Generic[]): ADFNode | null {
    // Look for YouTube links in tokens
    for (const token of tokens) {
      if (token.type === 'link') {
        const linkToken = token as Tokens.Link;
        const youtubeMatch = linkToken.href.match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
        );
        if (youtubeMatch) {
          // Return embedCard for YouTube videos (shows actual video player)
          return {
            type: 'embedCard',
            attrs: {
              url: linkToken.href,
              layout: 'wide',
            },
          };
        }
      }
    }
    return null;
  }

  private convertImage(token: Tokens.Image): ADFNode | null {
    // Check image limit
    if (this.options.maxImages && this.imageCount >= this.options.maxImages) {
      return null; // Skip images beyond limit
    }
    this.imageCount++;

    const href = token.href;

    // Local screenshot - use download URL if baseUrl and pageId are provided
    if (href.startsWith('./screenshots/') || !href.startsWith('http')) {
      const filename = href.replace('./screenshots/', '').replace('./', '');

      // If we have baseUrl and pageId, use the attachment download URL
      if (this.options.baseUrl && this.options.pageId) {
        const downloadUrl = `${this.options.baseUrl}/wiki/download/attachments/${this.options.pageId}/${encodeURIComponent(filename)}`;
        return {
          type: 'mediaSingle',
          attrs: { layout: 'center' },
          content: [
            {
              type: 'media',
              attrs: {
                type: 'external',
                url: downloadUrl,
                alt: token.text || filename,
              },
            },
          ],
        };
      }

      // Fallback: use placeholder (won't display properly until re-updated)
      return {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [
          {
            type: 'media',
            attrs: {
              type: 'file',
              collection: '', // Will be set by Confluence
              id: filename, // Filename as placeholder
              alt: token.text || filename,
            },
          },
        ],
      };
    }

    // External image
    return {
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [
        {
          type: 'media',
          attrs: {
            type: 'external',
            url: href,
            alt: token.text || '',
          },
        },
      ],
    };
  }

  private convertList(token: Tokens.List): ADFNode {
    const listType = token.ordered ? 'orderedList' : 'bulletList';

    return {
      type: listType,
      content: token.items.map((item) => this.convertListItem(item)),
    };
  }

  private convertListItem(item: Tokens.ListItem): ADFNode {
    const content: ADFNode[] = [];

    for (const token of item.tokens) {
      if (token.type === 'text') {
        const textToken = token as Tokens.Text & { tokens?: Tokens.Generic[] };
        if (textToken.tokens) {
          content.push({
            type: 'paragraph',
            content: this.convertInlineTokens(textToken.tokens),
          });
        } else {
          content.push({
            type: 'paragraph',
            content: [{ type: 'text', text: textToken.text }],
          });
        }
      } else if (token.type === 'paragraph') {
        content.push({
          type: 'paragraph',
          content: this.convertInlineTokens((token as Tokens.Paragraph).tokens),
        });
      } else if (token.type === 'list') {
        content.push(this.convertList(token as Tokens.List));
      }
    }

    return {
      type: 'listItem',
      content,
    };
  }

  private convertCodeBlock(token: Tokens.Code): ADFNode {
    return {
      type: 'codeBlock',
      attrs: { language: token.lang || 'text' },
      content: [{ type: 'text', text: token.text }],
    };
  }

  private convertBlockquote(token: Tokens.Blockquote): ADFNode {
    return {
      type: 'blockquote',
      content: this.convertTokens(token.tokens),
    };
  }

  private convertHorizontalRule(): ADFNode {
    return { type: 'rule' };
  }

  private convertTable(token: Tokens.Table): ADFNode {
    const rows: ADFNode[] = [];

    // Header row
    const headerCells = token.header.map((cell) => ({
      type: 'tableHeader',
      content: [
        {
          type: 'paragraph',
          content: this.convertInlineTokens(cell.tokens),
        },
      ],
    }));
    rows.push({ type: 'tableRow', content: headerCells });

    // Body rows
    for (const row of token.rows) {
      const cells = row.map((cell) => ({
        type: 'tableCell',
        content: [
          {
            type: 'paragraph',
            content: this.convertInlineTokens(cell.tokens),
          },
        ],
      }));
      rows.push({ type: 'tableRow', content: cells });
    }

    return {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'wide' },
      content: rows,
    };
  }

  private convertInlineTokens(tokens: Tokens.Generic[] | undefined): ADFNode[] {
    if (!tokens) return [];

    const nodes: ADFNode[] = [];

    for (const token of tokens) {
      const node = this.convertInlineToken(token);
      if (node) {
        if (Array.isArray(node)) {
          nodes.push(...node);
        } else {
          nodes.push(node);
        }
      }
    }

    return nodes;
  }

  private convertInlineToken(token: Tokens.Generic): ADFNode | ADFNode[] | null {
    switch (token.type) {
      case 'text':
        return this.convertText(token as Tokens.Text);
      case 'strong':
        return this.convertStrong(token as Tokens.Strong);
      case 'em':
        return this.convertEm(token as Tokens.Em);
      case 'codespan':
        return this.convertCodespan(token as Tokens.Codespan);
      case 'link':
        return this.convertLink(token as Tokens.Link);
      case 'image':
        // Images in inline context - convert to media
        return null; // Handle at paragraph level
      case 'br':
        return { type: 'hardBreak' };
      case 'del':
        return this.convertDel(token as Tokens.Del);
      default:
        if ('text' in token) {
          return { type: 'text', text: (token as unknown as { text: string }).text };
        }
        return null;
    }
  }

  private convertText(token: Tokens.Text): ADFNode {
    return { type: 'text', text: token.text };
  }

  private convertStrong(token: Tokens.Strong): ADFNode[] {
    const innerNodes = this.convertInlineTokens(token.tokens);
    return innerNodes.map((node) => ({
      ...node,
      marks: [...(node.marks || []), { type: 'strong' }],
    }));
  }

  private convertEm(token: Tokens.Em): ADFNode[] {
    const innerNodes = this.convertInlineTokens(token.tokens);
    return innerNodes.map((node) => ({
      ...node,
      marks: [...(node.marks || []), { type: 'em' }],
    }));
  }

  private convertCodespan(token: Tokens.Codespan): ADFNode {
    return {
      type: 'text',
      text: token.text,
      marks: [{ type: 'code' }],
    };
  }

  private convertLink(token: Tokens.Link): ADFNode | ADFNode[] {
    const href = token.href;

    // YouTube link - use embedCard for proper video embed display
    const youtubeMatch = href.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (youtubeMatch) {
      return {
        type: 'embedCard',
        attrs: {
          url: href,
          layout: 'wide',
        },
      };
    }

    // Regular link
    const innerNodes = this.convertInlineTokens(token.tokens);
    return innerNodes.map((node) => ({
      ...node,
      marks: [...(node.marks || []), { type: 'link', attrs: { href } }],
    }));
  }

  private convertDel(token: Tokens.Del): ADFNode[] {
    const innerNodes = this.convertInlineTokens(token.tokens);
    return innerNodes.map((node) => ({
      ...node,
      marks: [...(node.marks || []), { type: 'strike' }],
    }));
  }

  convertToIndexPage(
    playlistTitle: string,
    videos: Array<{
      title: string;
      pageId: string;
      pageUrl: string;
      pageTitle: string;
      videoId?: string;
      summary?: string;
    }>
  ): ADFDocument {
    const content: ADFNode[] = [];

    // Title
    content.push({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: playlistTitle }],
    });

    // Video count
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `총 ${videos.length}개 영상` }],
    });

    // Table
    const tableRows: ADFNode[] = [];

    // Header row
    tableRows.push({
      type: 'tableRow',
      content: [
        {
          type: 'tableHeader',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '영상' }] },
          ],
        },
        {
          type: 'tableHeader',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '하위 페이지' }] },
          ],
        },
        {
          type: 'tableHeader',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '요약' }] },
          ],
        },
      ],
    });

    // Video rows
    for (const video of videos) {
      const videoCell: ADFNode = video.videoId
        ? {
            type: 'tableCell',
            content: [
              {
                type: 'blockCard',
                attrs: {
                  url: `https://www.youtube.com/watch?v=${video.videoId}`,
                },
              },
            ],
          }
        : {
            type: 'tableCell',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: video.title }],
              },
            ],
          };

      const pageCell: ADFNode = {
        type: 'tableCell',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'inlineCard',
                attrs: {
                  url: video.pageUrl,
                },
              },
            ],
          },
        ],
      };

      const summaryCell: ADFNode = {
        type: 'tableCell',
        content: [
          {
            type: 'paragraph',
            content: video.summary
              ? [{ type: 'text', text: video.summary }]
              : [],
          },
        ],
      };

      tableRows.push({
        type: 'tableRow',
        content: [videoCell, pageCell, summaryCell],
      });
    }

    content.push({
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'full-width' },
      content: tableRows,
    });

    return {
      version: 1,
      type: 'doc',
      content,
    };
  }

  // Convert ADF document to JSON string for API
  toJsonString(doc: ADFDocument): string {
    return JSON.stringify(doc);
  }
}
