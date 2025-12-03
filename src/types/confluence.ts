export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  spaceKey: string;
  parentId?: string;
  body?: string;
  version?: number;
}

export interface ConfluenceCreatePageRequest {
  spaceId: string;
  parentId: string;
  title: string;
  body: string;
}

export interface ConfluenceAttachment {
  id: string;
  title: string;
  mediaType: string;
}

export interface UploadConfig {
  parentPageUrl: string;
}
