import { readFile } from 'fs/promises';
import type {
  ConfluenceConfig,
  ConfluencePage,
  ConfluenceCreatePageRequest,
  ConfluenceAttachment,
} from '../../types/index.js';

export class ConfluenceClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ConfluenceConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Confluence API error (${response.status}): ${errorText}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }

  parsePageUrl(url: string): { baseUrl: string; pageId: string } {
    // Confluence Cloud URL formats:
    // https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456/Page+Title
    // https://xxx.atlassian.net/wiki/spaces/SPACE/pages/123456
    const match = url.match(/^(https:\/\/[^/]+)\/wiki\/spaces\/[^/]+\/pages\/(\d+)/);
    if (!match) {
      throw new Error(`Invalid Confluence page URL: ${url}`);
    }
    return {
      baseUrl: match[1],
      pageId: match[2],
    };
  }

  async getPage(pageId: string): Promise<ConfluencePage> {
    const response = await this.request<{
      id: string;
      title: string;
      spaceId: string;
      parentId?: string;
      version: { number: number };
      body?: { storage: { value: string } };
    }>(`/wiki/api/v2/pages/${pageId}?body-format=storage`);

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.spaceId,
      parentId: response.parentId,
      body: response.body?.storage?.value,
      version: response.version?.number,
    };
  }

  async getSpaceIdFromPage(pageId: string): Promise<string> {
    const response = await this.request<{ spaceId: string }>(
      `/wiki/api/v2/pages/${pageId}`
    );
    return response.spaceId;
  }

  async createPage(request: ConfluenceCreatePageRequest): Promise<ConfluencePage> {
    const response = await this.request<{
      id: string;
      title: string;
      spaceId: string;
      parentId: string;
      version: { number: number };
    }>('/wiki/api/v2/pages', {
      method: 'POST',
      body: JSON.stringify({
        spaceId: request.spaceId,
        parentId: request.parentId,
        title: request.title,
        status: 'current',
        body: {
          representation: 'storage',
          value: request.body,
        },
      }),
    });

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.spaceId,
      parentId: response.parentId,
      version: response.version?.number,
    };
  }

  async updatePage(
    pageId: string,
    title: string,
    body: string,
    currentVersion: number
  ): Promise<ConfluencePage> {
    const response = await this.request<{
      id: string;
      title: string;
      spaceId: string;
      parentId: string;
      version: { number: number };
    }>(`/wiki/api/v2/pages/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify({
        id: pageId,
        title,
        status: 'current',
        body: {
          representation: 'storage',
          value: body,
        },
        version: {
          number: currentVersion + 1,
        },
      }),
    });

    return {
      id: response.id,
      title: response.title,
      spaceKey: response.spaceId,
      parentId: response.parentId,
      version: response.version?.number,
    };
  }

  async uploadAttachment(
    pageId: string,
    filePath: string,
    fileName: string
  ): Promise<ConfluenceAttachment> {
    const fileBuffer = await readFile(filePath);
    const blob = new Blob([fileBuffer]);

    const formData = new FormData();
    formData.append('file', blob, fileName);

    const url = `${this.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'X-Atlassian-Token': 'nocheck',
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload attachment (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as {
      results?: Array<{ id: string; title: string; mediaType: string }>;
      id?: string;
      title?: string;
      mediaType?: string;
    };
    const attachment = result.results?.[0] || result;

    return {
      id: attachment.id || '',
      title: attachment.title || '',
      mediaType: attachment.mediaType || '',
    };
  }

  async getChildPages(pageId: string): Promise<ConfluencePage[]> {
    const response = await this.request<{
      results: Array<{
        id: string;
        title: string;
        spaceId: string;
        parentId: string;
      }>;
    }>(`/wiki/api/v2/pages/${pageId}/children`);

    return response.results.map((page) => ({
      id: page.id,
      title: page.title,
      spaceKey: page.spaceId,
      parentId: page.parentId,
    }));
  }

  async findChildPageByTitle(
    parentId: string,
    title: string
  ): Promise<ConfluencePage | null> {
    const children = await this.getChildPages(parentId);
    return children.find((page) => page.title === title) || null;
  }

  getPageUrl(pageId: string): string {
    return `${this.baseUrl}/wiki/pages/${pageId}`;
  }
}
