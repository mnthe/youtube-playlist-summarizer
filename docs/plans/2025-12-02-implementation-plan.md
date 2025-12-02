# YouTube Playlist Summarizer - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** CLI 도구로 YouTube 재생목록을 Gemini(Vertex AI)로 분석하여 타임스탬프별 요약과 스크린샷이 포함된 마크다운 문서 생성

**Architecture:** Core + Adapter 패턴. core/에 비즈니스 로직, adapters/cli/에 Commander.js 기반 CLI. 상태는 JSON 파일로 관리.

**Tech Stack:** Node.js 20+, TypeScript, Commander.js, @google-cloud/vertexai, @googleapis/youtube, yt-dlp, ffmpeg

---

## Task 1: 프로젝트 초기 설정

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.ts`

**Step 1: package.json 생성**

```bash
npm init -y
```

**Step 2: 의존성 설치**

```bash
npm install typescript @types/node tsx --save-dev
npm install commander dotenv @google-cloud/vertexai googleapis
```

**Step 3: tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: .env.example 생성**

```bash
# YouTube Data API
YOUTUBE_API_KEY=your-youtube-api-key

# Google Cloud / Vertex AI
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1
```

**Step 5: .gitignore 생성**

```
node_modules/
dist/
.env
output/
*.log
```

**Step 6: src/index.ts 생성 (진입점)**

```typescript
#!/usr/bin/env node

console.log('YouTube Playlist Summarizer');
```

**Step 7: package.json scripts 추가**

```json
{
  "type": "module",
  "bin": {
    "yt-summarize": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  }
}
```

**Step 8: 실행 테스트**

Run: `npm run dev`
Expected: "YouTube Playlist Summarizer" 출력

**Step 9: 커밋**

```bash
git add -A
git commit -m "chore: initialize project with TypeScript setup"
```

---

## Task 2: 공유 타입 정의

**Files:**
- Create: `src/types/index.ts`
- Create: `src/types/youtube.ts`
- Create: `src/types/gemini.ts`
- Create: `src/types/state.ts`

**Step 1: YouTube 관련 타입**

Create `src/types/youtube.ts`:

```typescript
export interface PlaylistInfo {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  videoCount: number;
}

export interface VideoInfo {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  duration: string; // ISO 8601 duration (PT15M30S)
  durationSeconds: number;
  thumbnailUrl: string;
  url: string;
}
```

**Step 2: Gemini 관련 타입**

Create `src/types/gemini.ts`:

```typescript
export interface TimestampSection {
  timestamp: string; // "00:01:30" format
  seconds: number;
  title: string;
  content: string;
}

export interface VideoSummary {
  overview: string;
  sections: TimestampSection[];
  keyPoints: string[];
}
```

**Step 3: 상태 관련 타입**

Create `src/types/state.ts`:

```typescript
export type ProcessStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface SummaryState {
  status: ProcessStatus;
  completedAt?: string;
  timestamps?: string[];
  error?: string;
}

export interface ScreenshotState {
  status: ProcessStatus;
  total: number;
  completed: number;
  files: string[];
  error?: string;
}

export interface VideoState {
  title: string;
  outputDir: string;
  summary: SummaryState;
  screenshots: ScreenshotState;
}

export interface PlaylistState {
  playlistId: string;
  playlistTitle: string;
  config: {
    locale: string;
    withScreenshots: boolean;
  };
  totalVideos: number;
  createdAt: string;
  updatedAt: string;
  videos: Record<string, VideoState>;
}
```

**Step 4: 인덱스 파일**

Create `src/types/index.ts`:

```typescript
export * from './youtube.js';
export * from './gemini.js';
export * from './state.js';

export interface SummarizerConfig {
  playlistUrl?: string;
  videoUrl?: string;
  locale: string;
  outputDir: string;
  concurrency: number;
  withScreenshots: boolean;
  retryCount: number;
}
```

**Step 5: 커밋**

```bash
git add src/types/
git commit -m "feat: add shared type definitions"
```

---

## Task 3: YouTube 클라이언트 구현

**Files:**
- Create: `src/core/youtube/client.ts`
- Create: `src/core/youtube/index.ts`
- Create: `tests/core/youtube/client.test.ts`

**Step 1: 테스트 환경 설정**

```bash
npm install vitest --save-dev
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**Step 2: 테스트 작성**

Create `tests/core/youtube/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YouTubeClient } from '../../../src/core/youtube/client.js';

describe('YouTubeClient', () => {
  describe('parsePlaylistId', () => {
    it('should extract playlist ID from full URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      expect(client.parsePlaylistId(url)).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    it('should extract playlist ID from short URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://youtube.com/playlist?list=PLtest123';
      expect(client.parsePlaylistId(url)).toBe('PLtest123');
    });

    it('should throw error for invalid URL', () => {
      const client = new YouTubeClient('fake-api-key');
      expect(() => client.parsePlaylistId('invalid-url')).toThrow('Invalid playlist URL');
    });
  });

  describe('parseVideoId', () => {
    it('should extract video ID from watch URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(client.parseVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from short URL', () => {
      const client = new YouTubeClient('fake-api-key');
      const url = 'https://youtu.be/dQw4w9WgXcQ';
      expect(client.parseVideoId(url)).toBe('dQw4w9WgXcQ');
    });
  });

  describe('parseDuration', () => {
    it('should parse ISO 8601 duration to seconds', () => {
      const client = new YouTubeClient('fake-api-key');
      expect(client.parseDuration('PT15M30S')).toBe(930);
      expect(client.parseDuration('PT1H30M')).toBe(5400);
      expect(client.parseDuration('PT45S')).toBe(45);
    });
  });
});
```

**Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL - "YouTubeClient" not found

**Step 4: YouTube 클라이언트 구현**

Create `src/core/youtube/client.ts`:

```typescript
import { google, youtube_v3 } from 'googleapis';
import type { PlaylistInfo, VideoInfo } from '../../types/index.js';

export class YouTubeClient {
  private youtube: youtube_v3.Youtube;

  constructor(apiKey: string) {
    this.youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });
  }

  parsePlaylistId(url: string): string {
    const patterns = [
      /[?&]list=([a-zA-Z0-9_-]+)/,
      /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    throw new Error('Invalid playlist URL');
  }

  parseVideoId(url: string): string {
    const patterns = [
      /youtu\.be\/([a-zA-Z0-9_-]+)/,
      /[?&]v=([a-zA-Z0-9_-]+)/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    throw new Error('Invalid video URL');
  }

  parseDuration(isoDuration: string): number {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    return hours * 3600 + minutes * 60 + seconds;
  }

  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async getPlaylistInfo(playlistId: string): Promise<PlaylistInfo> {
    const response = await this.youtube.playlists.list({
      part: ['snippet', 'contentDetails'],
      id: [playlistId],
    });

    const playlist = response.data.items?.[0];
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    return {
      id: playlist.id!,
      title: playlist.snippet?.title || '',
      description: playlist.snippet?.description || '',
      channelTitle: playlist.snippet?.channelTitle || '',
      videoCount: playlist.contentDetails?.itemCount || 0,
    };
  }

  async getPlaylistVideos(playlistId: string): Promise<VideoInfo[]> {
    const videos: VideoInfo[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults: 50,
        pageToken,
      });

      const videoIds = response.data.items
        ?.map((item) => item.contentDetails?.videoId)
        .filter((id): id is string => !!id) || [];

      if (videoIds.length > 0) {
        const videoDetails = await this.getVideoDetails(videoIds);
        videos.push(...videoDetails);
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return videos;
  }

  async getVideoDetails(videoIds: string[]): Promise<VideoInfo[]> {
    const response = await this.youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: videoIds,
    });

    return (response.data.items || []).map((video) => ({
      id: video.id!,
      title: video.snippet?.title || '',
      description: video.snippet?.description || '',
      channelTitle: video.snippet?.channelTitle || '',
      publishedAt: video.snippet?.publishedAt || '',
      duration: video.contentDetails?.duration || 'PT0S',
      durationSeconds: this.parseDuration(video.contentDetails?.duration || 'PT0S'),
      thumbnailUrl: video.snippet?.thumbnails?.high?.url || '',
      url: `https://www.youtube.com/watch?v=${video.id}`,
    }));
  }

  async getVideo(videoId: string): Promise<VideoInfo> {
    const videos = await this.getVideoDetails([videoId]);
    if (videos.length === 0) {
      throw new Error(`Video not found: ${videoId}`);
    }
    return videos[0];
  }
}
```

**Step 5: 인덱스 파일**

Create `src/core/youtube/index.ts`:

```typescript
export { YouTubeClient } from './client.js';
```

**Step 6: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

**Step 7: 커밋**

```bash
git add -A
git commit -m "feat: implement YouTube client with playlist and video fetching"
```

---

## Task 4: Gemini (Vertex AI) 클라이언트 구현

**Files:**
- Create: `src/core/gemini/client.ts`
- Create: `src/core/gemini/prompts.ts`
- Create: `src/core/gemini/index.ts`

**Step 1: 프롬프트 템플릿 작성**

Create `src/core/gemini/prompts.ts`:

```typescript
export function createSummaryPrompt(locale: string): string {
  const localeInstructions: Record<string, string> = {
    ko: '한국어로 응답해주세요.',
    en: 'Please respond in English.',
    ja: '日本語で回答してください。',
    zh: '请用中文回答。',
  };

  const langInstruction = localeInstructions[locale] || localeInstructions.en;

  return `
You are a video content analyzer. Analyze the provided YouTube video and create a structured summary.

${langInstruction}

Please provide your response in the following JSON format:
{
  "overview": "A 2-3 sentence overview of the entire video content",
  "sections": [
    {
      "timestamp": "MM:SS or HH:MM:SS format",
      "title": "Section title",
      "content": "Detailed explanation of what happens at this timestamp (2-3 sentences)"
    }
  ],
  "keyPoints": [
    "Key point 1",
    "Key point 2",
    "Key point 3"
  ]
}

Guidelines:
1. Identify 5-10 key timestamps where important content changes or key points are made
2. For each section, note the exact timestamp and provide a meaningful title
3. The content should explain what is being discussed or demonstrated at that timestamp
4. Key points should be actionable takeaways from the video
5. Be specific and detailed, not generic

IMPORTANT: Return ONLY valid JSON, no markdown code blocks or additional text.
`;
}
```

**Step 2: Gemini 클라이언트 구현**

Create `src/core/gemini/client.ts`:

```typescript
import { VertexAI, GenerativeModel } from '@google-cloud/vertexai';
import type { VideoSummary, TimestampSection } from '../../types/index.js';
import { createSummaryPrompt } from './prompts.js';

export interface GeminiClientConfig {
  projectId: string;
  location: string;
  model?: string;
}

export class GeminiClient {
  private model: GenerativeModel;

  constructor(config: GeminiClientConfig) {
    const vertexAI = new VertexAI({
      project: config.projectId,
      location: config.location,
    });

    this.model = vertexAI.getGenerativeModel({
      model: config.model || 'gemini-2.0-flash',
    });
  }

  async summarizeVideo(videoUrl: string, locale: string): Promise<VideoSummary> {
    const prompt = createSummaryPrompt(locale);

    const request = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: videoUrl,
                mimeType: 'video/mp4',
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const response = await this.model.generateContent(request);
    const result = response.response;
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('No response from Gemini');
    }

    return this.parseResponse(text);
  }

  private parseResponse(text: string): VideoSummary {
    // Clean up the response - remove markdown code blocks if present
    let cleanText = text.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.slice(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.slice(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.slice(0, -3);
    }
    cleanText = cleanText.trim();

    try {
      const parsed = JSON.parse(cleanText);

      // Validate and transform sections
      const sections: TimestampSection[] = (parsed.sections || []).map(
        (section: { timestamp: string; title: string; content: string }) => ({
          timestamp: section.timestamp,
          seconds: this.parseTimestamp(section.timestamp),
          title: section.title,
          content: section.content,
        })
      );

      return {
        overview: parsed.overview || '',
        sections,
        keyPoints: parsed.keyPoints || [],
      };
    } catch (error) {
      throw new Error(`Failed to parse Gemini response: ${error}`);
    }
  }

  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }
}
```

**Step 3: 인덱스 파일**

Create `src/core/gemini/index.ts`:

```typescript
export { GeminiClient, type GeminiClientConfig } from './client.js';
export { createSummaryPrompt } from './prompts.js';
```

**Step 4: 커밋**

```bash
git add src/core/gemini/
git commit -m "feat: implement Gemini/Vertex AI client for video summarization"
```

---

## Task 5: 스크린샷 캡처 구현

**Files:**
- Create: `src/core/screenshot/capturer.ts`
- Create: `src/core/screenshot/index.ts`

**Step 1: 스크린샷 캡처 구현**

Create `src/core/screenshot/capturer.ts`:

```typescript
import { spawn } from 'child_process';
import { mkdir, unlink, access } from 'fs/promises';
import { join, dirname } from 'path';

export interface CaptureResult {
  timestamp: string;
  filePath: string;
  success: boolean;
  error?: string;
}

export class ScreenshotCapturer {
  private tempDir: string;

  constructor(tempDir: string = '/tmp/yt-summarize') {
    this.tempDir = tempDir;
  }

  async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private formatTimestampForFilename(timestamp: string): string {
    return timestamp.replace(/:/g, '-');
  }

  private async runCommand(
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code: code || 0 });
      });

      proc.on('error', (err) => {
        resolve({ stdout, stderr: err.message, code: 1 });
      });
    });
  }

  async captureScreenshot(
    videoUrl: string,
    timestamp: string,
    outputPath: string
  ): Promise<CaptureResult> {
    const seconds = this.parseTimestamp(timestamp);
    const startTime = Math.max(0, seconds - 1);
    const endTime = seconds + 1;

    await this.ensureDir(dirname(outputPath));
    await this.ensureDir(this.tempDir);

    const tempVideo = join(
      this.tempDir,
      `temp-${Date.now()}-${this.formatTimestampForFilename(timestamp)}.mp4`
    );

    try {
      // Step 1: Download video segment using yt-dlp
      const downloadResult = await this.runCommand('yt-dlp', [
        '--download-sections',
        `*${this.formatTimeForYtdlp(startTime)}-${this.formatTimeForYtdlp(endTime)}`,
        '-f',
        'best[height<=720]',
        '-o',
        tempVideo,
        '--force-keyframes-at-cuts',
        videoUrl,
      ]);

      if (downloadResult.code !== 0) {
        return {
          timestamp,
          filePath: outputPath,
          success: false,
          error: `yt-dlp failed: ${downloadResult.stderr}`,
        };
      }

      // Step 2: Extract frame using ffmpeg
      const ffmpegResult = await this.runCommand('ffmpeg', [
        '-y',
        '-i',
        tempVideo,
        '-vf',
        `select='eq(n,0)'`,
        '-vframes',
        '1',
        '-q:v',
        '2',
        outputPath,
      ]);

      if (ffmpegResult.code !== 0) {
        return {
          timestamp,
          filePath: outputPath,
          success: false,
          error: `ffmpeg failed: ${ffmpegResult.stderr}`,
        };
      }

      // Verify file exists
      await access(outputPath);

      return {
        timestamp,
        filePath: outputPath,
        success: true,
      };
    } catch (error) {
      return {
        timestamp,
        filePath: outputPath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Cleanup temp file
      try {
        await unlink(tempVideo);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async captureMultiple(
    videoUrl: string,
    timestamps: string[],
    outputDir: string
  ): Promise<CaptureResult[]> {
    const results: CaptureResult[] = [];

    for (const timestamp of timestamps) {
      const filename = `${this.formatTimestampForFilename(timestamp)}.png`;
      const outputPath = join(outputDir, filename);

      const result = await this.captureScreenshot(videoUrl, timestamp, outputPath);
      results.push(result);
    }

    return results;
  }

  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }

  private formatTimeForYtdlp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
```

**Step 2: 인덱스 파일**

Create `src/core/screenshot/index.ts`:

```typescript
export { ScreenshotCapturer, type CaptureResult } from './capturer.js';
```

**Step 3: 커밋**

```bash
git add src/core/screenshot/
git commit -m "feat: implement screenshot capturer with yt-dlp and ffmpeg"
```

---

## Task 6: 상태 관리자 구현

**Files:**
- Create: `src/core/state/manager.ts`
- Create: `src/core/state/index.ts`

**Step 1: 상태 관리자 구현**

Create `src/core/state/manager.ts`:

```typescript
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import type {
  PlaylistState,
  VideoState,
  ProcessStatus,
  SummaryState,
  ScreenshotState,
} from '../../types/index.js';

export class StateManager {
  private statePath: string;
  private state: PlaylistState | null = null;

  constructor(outputDir: string, playlistId: string) {
    this.statePath = join(outputDir, `playlist-${playlistId}`, 'state.json');
  }

  async load(): Promise<PlaylistState | null> {
    try {
      await access(this.statePath);
      const content = await readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content);
      return this.state;
    } catch {
      return null;
    }
  }

  async initialize(
    playlistId: string,
    playlistTitle: string,
    config: { locale: string; withScreenshots: boolean },
    videos: Array<{ id: string; title: string }>
  ): Promise<PlaylistState> {
    const now = new Date().toISOString();

    this.state = {
      playlistId,
      playlistTitle,
      config,
      totalVideos: videos.length,
      createdAt: now,
      updatedAt: now,
      videos: {},
    };

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const paddedIndex = String(i + 1).padStart(2, '0');
      const safeTitle = this.sanitizeFilename(video.title);
      const outputDir = `${paddedIndex}-${safeTitle}`;

      this.state.videos[video.id] = {
        title: video.title,
        outputDir,
        summary: { status: 'pending' },
        screenshots: { status: 'pending', total: 0, completed: 0, files: [] },
      };
    }

    await this.save();
    return this.state;
  }

  async save(): Promise<void> {
    if (!this.state) return;

    this.state.updatedAt = new Date().toISOString();

    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2));
  }

  getState(): PlaylistState | null {
    return this.state;
  }

  getVideoState(videoId: string): VideoState | null {
    return this.state?.videos[videoId] || null;
  }

  async updateSummaryStatus(
    videoId: string,
    status: ProcessStatus,
    timestamps?: string[],
    error?: string
  ): Promise<void> {
    if (!this.state?.videos[videoId]) return;

    const summary: SummaryState = {
      status,
      ...(status === 'completed' && { completedAt: new Date().toISOString() }),
      ...(timestamps && { timestamps }),
      ...(error && { error }),
    };

    this.state.videos[videoId].summary = summary;

    if (timestamps) {
      this.state.videos[videoId].screenshots.total = timestamps.length;
    }

    await this.save();
  }

  async updateScreenshotStatus(
    videoId: string,
    status: ProcessStatus,
    completedCount: number,
    files: string[],
    error?: string
  ): Promise<void> {
    if (!this.state?.videos[videoId]) return;

    const screenshots: ScreenshotState = {
      status,
      total: this.state.videos[videoId].screenshots.total,
      completed: completedCount,
      files,
      ...(error && { error }),
    };

    this.state.videos[videoId].screenshots = screenshots;
    await this.save();
  }

  getPendingVideos(): string[] {
    if (!this.state) return [];

    return Object.entries(this.state.videos)
      .filter(([_, video]) => {
        const summaryDone = video.summary.status === 'completed';
        const screenshotsDone =
          !this.state!.config.withScreenshots ||
          video.screenshots.status === 'completed';
        return !(summaryDone && screenshotsDone);
      })
      .map(([id]) => id);
  }

  getFailedVideos(): string[] {
    if (!this.state) return [];

    return Object.entries(this.state.videos)
      .filter(
        ([_, video]) =>
          video.summary.status === 'failed' || video.screenshots.status === 'failed'
      )
      .map(([id]) => id);
  }

  getStats(): {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    pending: number;
  } {
    if (!this.state) {
      return { total: 0, completed: 0, inProgress: 0, failed: 0, pending: 0 };
    }

    let completed = 0;
    let inProgress = 0;
    let failed = 0;
    let pending = 0;

    for (const video of Object.values(this.state.videos)) {
      const summaryDone = video.summary.status === 'completed';
      const screenshotsDone =
        !this.state.config.withScreenshots ||
        video.screenshots.status === 'completed';

      if (video.summary.status === 'failed' || video.screenshots.status === 'failed') {
        failed++;
      } else if (summaryDone && screenshotsDone) {
        completed++;
      } else if (
        video.summary.status === 'in_progress' ||
        video.screenshots.status === 'in_progress'
      ) {
        inProgress++;
      } else {
        pending++;
      }
    }

    return {
      total: this.state.totalVideos,
      completed,
      inProgress,
      failed,
      pending,
    };
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50);
  }
}
```

**Step 2: 인덱스 파일**

Create `src/core/state/index.ts`:

```typescript
export { StateManager } from './manager.js';
```

**Step 3: 커밋**

```bash
git add src/core/state/
git commit -m "feat: implement state manager for tracking progress"
```

---

## Task 7: 마크다운 생성기 구현

**Files:**
- Create: `src/core/output/markdown.ts`
- Create: `src/core/output/index.ts`

**Step 1: 마크다운 생성기 구현**

Create `src/core/output/markdown.ts`:

```typescript
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { VideoInfo, VideoSummary } from '../../types/index.js';

export interface MarkdownOptions {
  locale: string;
  withScreenshots: boolean;
  screenshotFiles?: string[];
}

export class MarkdownGenerator {
  generate(video: VideoInfo, summary: VideoSummary, options: MarkdownOptions): string {
    const frontmatter = this.generateFrontmatter(video, options.locale);
    const description = this.generateDescription(video);
    const summarySection = this.generateSummary(summary, options);
    const keyPoints = this.generateKeyPoints(summary.keyPoints);

    return `${frontmatter}

${description}

---

${summarySection}

---

${keyPoints}
`;
  }

  private generateFrontmatter(video: VideoInfo, locale: string): string {
    const publishedDate = video.publishedAt
      ? new Date(video.publishedAt).toISOString().split('T')[0]
      : '';

    return `---
title: "${this.escapeYaml(video.title)}"
channel: "${this.escapeYaml(video.channelTitle)}"
published: "${publishedDate}"
duration: "${this.formatDuration(video.durationSeconds)}"
url: "${video.url}"
summarized_at: "${new Date().toISOString()}"
locale: "${locale}"
---`;
  }

  private generateDescription(video: VideoInfo): string {
    return `## 영상 설명

${video.description || '(설명 없음)'}`;
  }

  private generateSummary(summary: VideoSummary, options: MarkdownOptions): string {
    let content = `## 요약

${summary.overview}

### 주요 내용

`;

    for (const section of summary.sections) {
      content += `#### [${section.timestamp}] ${section.title}\n\n`;

      if (options.withScreenshots) {
        const timestampFile = section.timestamp.replace(/:/g, '-');
        content += `![${section.timestamp}](./screenshots/${timestampFile}.png)\n\n`;
      }

      content += `${section.content}\n\n`;
    }

    return content;
  }

  private generateKeyPoints(keyPoints: string[]): string {
    if (keyPoints.length === 0) return '';

    const points = keyPoints.map((point) => `- ${point}`).join('\n');

    return `## 핵심 포인트

${points}`;
  }

  async writeToFile(content: string, outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf-8');
  }

  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private escapeYaml(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
  }
}
```

**Step 2: 인덱스 파일**

Create `src/core/output/index.ts`:

```typescript
export { MarkdownGenerator, type MarkdownOptions } from './markdown.js';
```

**Step 3: 커밋**

```bash
git add src/core/output/
git commit -m "feat: implement markdown generator for video summaries"
```

---

## Task 8: 메인 Summarizer 오케스트레이터 구현

**Files:**
- Create: `src/core/summarizer.ts`
- Create: `src/core/index.ts`

**Step 1: Summarizer 구현**

Create `src/core/summarizer.ts`:

```typescript
import { join } from 'path';
import { YouTubeClient } from './youtube/index.js';
import { GeminiClient } from './gemini/index.js';
import { ScreenshotCapturer } from './screenshot/index.js';
import { StateManager } from './state/index.js';
import { MarkdownGenerator } from './output/index.js';
import type { SummarizerConfig, VideoInfo } from '../types/index.js';

export interface SummarizerCallbacks {
  onProgress?: (message: string) => void;
  onVideoStart?: (video: VideoInfo, index: number, total: number) => void;
  onVideoComplete?: (video: VideoInfo, index: number, total: number) => void;
  onVideoError?: (video: VideoInfo, error: Error) => void;
}

export class Summarizer {
  private youtube: YouTubeClient;
  private gemini: GeminiClient;
  private screenshotCapturer: ScreenshotCapturer;
  private markdownGenerator: MarkdownGenerator;

  constructor(
    youtubeApiKey: string,
    geminiConfig: { projectId: string; location: string }
  ) {
    this.youtube = new YouTubeClient(youtubeApiKey);
    this.gemini = new GeminiClient(geminiConfig);
    this.screenshotCapturer = new ScreenshotCapturer();
    this.markdownGenerator = new MarkdownGenerator();
  }

  async summarizePlaylist(
    config: SummarizerConfig,
    callbacks: SummarizerCallbacks = {}
  ): Promise<void> {
    const { onProgress, onVideoStart, onVideoComplete, onVideoError } = callbacks;

    if (!config.playlistUrl) {
      throw new Error('Playlist URL is required');
    }

    // Parse playlist ID
    const playlistId = this.youtube.parsePlaylistId(config.playlistUrl);
    onProgress?.(`재생목록 ID: ${playlistId}`);

    // Initialize state manager
    const stateManager = new StateManager(config.outputDir, playlistId);

    // Try to load existing state
    let state = await stateManager.load();

    if (!state) {
      // Fetch playlist info
      onProgress?.('재생목록 정보를 가져오는 중...');
      const playlistInfo = await this.youtube.getPlaylistInfo(playlistId);
      onProgress?.(`재생목록: ${playlistInfo.title} (${playlistInfo.videoCount}개 영상)`);

      // Fetch all videos
      onProgress?.('영상 목록을 가져오는 중...');
      const videos = await this.youtube.getPlaylistVideos(playlistId);
      onProgress?.(`${videos.length}개 영상 발견`);

      // Initialize state
      state = await stateManager.initialize(
        playlistId,
        playlistInfo.title,
        { locale: config.locale, withScreenshots: config.withScreenshots },
        videos.map((v) => ({ id: v.id, title: v.title }))
      );
    } else {
      onProgress?.(`기존 상태 로드됨: ${state.playlistTitle}`);
    }

    // Get pending videos
    const pendingVideoIds = stateManager.getPendingVideos();
    onProgress?.(`처리 대기 중: ${pendingVideoIds.length}개 영상`);

    if (pendingVideoIds.length === 0) {
      onProgress?.('모든 영상이 이미 처리되었습니다.');
      return;
    }

    // Get video details for pending videos
    const videos = await this.youtube.getVideoDetails(pendingVideoIds);

    // Process each video
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoState = stateManager.getVideoState(video.id);
      if (!videoState) continue;

      onVideoStart?.(video, i + 1, videos.length);

      try {
        const outputDir = join(
          config.outputDir,
          `playlist-${playlistId}`,
          videoState.outputDir
        );

        // Step 1: Summarize with Gemini (if not done)
        let timestamps: string[] = [];

        if (videoState.summary.status !== 'completed') {
          onProgress?.(`[${i + 1}/${videos.length}] Gemini로 요약 중: ${video.title}`);

          await stateManager.updateSummaryStatus(video.id, 'in_progress');

          const summary = await this.gemini.summarizeVideo(video.url, config.locale);
          timestamps = summary.sections.map((s) => s.timestamp);

          // Generate markdown
          const markdown = this.markdownGenerator.generate(video, summary, {
            locale: config.locale,
            withScreenshots: config.withScreenshots,
          });

          // Write markdown file
          const markdownPath = join(outputDir, 'README.md');
          await this.markdownGenerator.writeToFile(markdown, markdownPath);

          await stateManager.updateSummaryStatus(video.id, 'completed', timestamps);
          onProgress?.(`요약 완료: ${video.title}`);
        } else {
          timestamps = videoState.summary.timestamps || [];
          onProgress?.(`요약 이미 완료됨: ${video.title}`);
        }

        // Step 2: Capture screenshots (if enabled and not done)
        if (
          config.withScreenshots &&
          videoState.screenshots.status !== 'completed' &&
          timestamps.length > 0
        ) {
          onProgress?.(
            `[${i + 1}/${videos.length}] 스크린샷 캡처 중: ${timestamps.length}개`
          );

          await stateManager.updateScreenshotStatus(video.id, 'in_progress', 0, []);

          const screenshotDir = join(outputDir, 'screenshots');
          const results = await this.screenshotCapturer.captureMultiple(
            video.url,
            timestamps,
            screenshotDir
          );

          const successfulFiles = results
            .filter((r) => r.success)
            .map((r) => r.filePath.split('/').pop()!);

          const failedCount = results.filter((r) => !r.success).length;

          if (failedCount > 0) {
            const errors = results
              .filter((r) => !r.success)
              .map((r) => r.error)
              .join('; ');

            await stateManager.updateScreenshotStatus(
              video.id,
              failedCount === results.length ? 'failed' : 'completed',
              successfulFiles.length,
              successfulFiles,
              errors
            );
          } else {
            await stateManager.updateScreenshotStatus(
              video.id,
              'completed',
              successfulFiles.length,
              successfulFiles
            );
          }

          onProgress?.(
            `스크린샷 완료: ${successfulFiles.length}/${timestamps.length}`
          );
        }

        onVideoComplete?.(video, i + 1, videos.length);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onVideoError?.(video, err);

        // Update state with error
        if (videoState.summary.status !== 'completed') {
          await stateManager.updateSummaryStatus(video.id, 'failed', undefined, err.message);
        } else {
          await stateManager.updateScreenshotStatus(
            video.id,
            'failed',
            videoState.screenshots.completed,
            videoState.screenshots.files,
            err.message
          );
        }
      }
    }

    const stats = stateManager.getStats();
    onProgress?.(
      `완료! 성공: ${stats.completed}, 실패: ${stats.failed}, 대기: ${stats.pending}`
    );
  }

  async summarizeVideo(
    videoUrl: string,
    config: Omit<SummarizerConfig, 'playlistUrl'>,
    callbacks: SummarizerCallbacks = {}
  ): Promise<void> {
    const { onProgress } = callbacks;

    const videoId = this.youtube.parseVideoId(videoUrl);
    onProgress?.(`영상 ID: ${videoId}`);

    const video = await this.youtube.getVideo(videoId);
    onProgress?.(`영상: ${video.title}`);

    // Summarize
    onProgress?.('Gemini로 요약 중...');
    const summary = await this.gemini.summarizeVideo(video.url, config.locale);
    const timestamps = summary.sections.map((s) => s.timestamp);
    onProgress?.(`요약 완료: ${timestamps.length}개 타임스탬프`);

    // Create output directory
    const safeTitle = video.title
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50);

    const outputDir = join(config.outputDir, safeTitle);

    // Generate and write markdown
    const markdown = this.markdownGenerator.generate(video, summary, {
      locale: config.locale,
      withScreenshots: config.withScreenshots,
    });

    const markdownPath = join(outputDir, 'README.md');
    await this.markdownGenerator.writeToFile(markdown, markdownPath);
    onProgress?.(`마크다운 저장됨: ${markdownPath}`);

    // Capture screenshots
    if (config.withScreenshots && timestamps.length > 0) {
      onProgress?.(`스크린샷 캡처 중: ${timestamps.length}개`);
      const screenshotDir = join(outputDir, 'screenshots');
      const results = await this.screenshotCapturer.captureMultiple(
        video.url,
        timestamps,
        screenshotDir
      );

      const successCount = results.filter((r) => r.success).length;
      onProgress?.(`스크린샷 완료: ${successCount}/${timestamps.length}`);
    }

    onProgress?.('완료!');
  }
}
```

**Step 2: Core 인덱스 파일**

Create `src/core/index.ts`:

```typescript
export { Summarizer, type SummarizerCallbacks } from './summarizer.js';
export { YouTubeClient } from './youtube/index.js';
export { GeminiClient } from './gemini/index.js';
export { ScreenshotCapturer } from './screenshot/index.js';
export { StateManager } from './state/index.js';
export { MarkdownGenerator } from './output/index.js';
```

**Step 3: 커밋**

```bash
git add src/core/summarizer.ts src/core/index.ts
git commit -m "feat: implement main summarizer orchestrator"
```

---

## Task 9: CLI 어댑터 구현

**Files:**
- Modify: `src/index.ts`
- Create: `src/adapters/cli/index.ts`
- Create: `src/adapters/cli/commands/summarize.ts`
- Create: `src/adapters/cli/commands/status.ts`

**Step 1: Summarize 명령어 구현**

Create `src/adapters/cli/commands/summarize.ts`:

```typescript
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { Summarizer } from '../../../core/index.js';
import type { SummarizerConfig } from '../../../types/index.js';

loadEnv();

export function createSummarizeCommand(): Command {
  const command = new Command('summarize')
    .description('YouTube 재생목록 또는 영상을 요약합니다')
    .option('-p, --playlist <url>', '재생목록 URL')
    .option('-v, --video <url>', '단일 영상 URL')
    .option('-l, --locale <locale>', '출력 언어', 'ko')
    .option('-o, --output <dir>', '출력 디렉토리', './output')
    .option('-c, --concurrency <number>', '동시 처리 수', '1')
    .option('--no-screenshots', '스크린샷 제외')
    .option('-r, --retry <number>', '재시도 횟수', '3')
    .action(async (options) => {
      const youtubeApiKey = process.env.YOUTUBE_API_KEY;
      const projectId = process.env.GOOGLE_CLOUD_PROJECT;
      const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      if (!youtubeApiKey) {
        console.error('❌ YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.');
        process.exit(1);
      }

      if (!projectId) {
        console.error('❌ GOOGLE_CLOUD_PROJECT 환경변수가 설정되지 않았습니다.');
        process.exit(1);
      }

      if (!options.playlist && !options.video) {
        console.error('❌ --playlist 또는 --video 옵션이 필요합니다.');
        process.exit(1);
      }

      const config: SummarizerConfig = {
        playlistUrl: options.playlist,
        videoUrl: options.video,
        locale: options.locale,
        outputDir: options.output,
        concurrency: parseInt(options.concurrency, 10),
        withScreenshots: options.screenshots !== false,
        retryCount: parseInt(options.retry, 10),
      };

      const summarizer = new Summarizer(youtubeApiKey, { projectId, location });

      const callbacks = {
        onProgress: (message: string) => console.log(`ℹ️  ${message}`),
        onVideoStart: (video: { title: string }, index: number, total: number) =>
          console.log(`\n🎬 [${index}/${total}] 시작: ${video.title}`),
        onVideoComplete: (video: { title: string }, index: number, total: number) =>
          console.log(`✅ [${index}/${total}] 완료: ${video.title}`),
        onVideoError: (video: { title: string }, error: Error) =>
          console.error(`❌ 오류 (${video.title}): ${error.message}`),
      };

      try {
        if (options.playlist) {
          await summarizer.summarizePlaylist(config, callbacks);
        } else if (options.video) {
          await summarizer.summarizeVideo(options.video, config, callbacks);
        }
      } catch (error) {
        console.error('❌ 오류:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return command;
}
```

**Step 2: Status 명령어 구현**

Create `src/adapters/cli/commands/status.ts`:

```typescript
import { Command } from 'commander';
import { StateManager } from '../../../core/index.js';

export function createStatusCommand(): Command {
  const command = new Command('status')
    .description('재생목록 처리 상태를 확인합니다')
    .requiredOption('-p, --playlist <id>', '재생목록 ID')
    .option('-o, --output <dir>', '출력 디렉토리', './output')
    .action(async (options) => {
      const stateManager = new StateManager(options.output, options.playlist);
      const state = await stateManager.load();

      if (!state) {
        console.log('❌ 상태 파일을 찾을 수 없습니다.');
        console.log(`   경로: ${options.output}/playlist-${options.playlist}/state.json`);
        process.exit(1);
      }

      const stats = stateManager.getStats();

      console.log('');
      console.log('┌─────────────────────────────────────────────────────┐');
      console.log(`│ 재생목록: ${state.playlistTitle.slice(0, 40).padEnd(40)} │`);
      console.log('├─────────────────────────────────────────────────────┤');
      console.log(`│ ✅ 완료:    ${String(stats.completed).padStart(3)}                                    │`);
      console.log(`│ ⏳ 진행중:  ${String(stats.inProgress).padStart(3)}                                    │`);
      console.log(`│ ❌ 실패:    ${String(stats.failed).padStart(3)}                                    │`);
      console.log(`│ ⬚  대기:    ${String(stats.pending).padStart(3)}                                    │`);
      console.log('└─────────────────────────────────────────────────────┘');

      if (stats.failed > 0) {
        console.log('\n실패한 영상:');
        const failedVideos = stateManager.getFailedVideos();
        for (const videoId of failedVideos) {
          const videoState = stateManager.getVideoState(videoId);
          if (videoState) {
            const error =
              videoState.summary.error || videoState.screenshots.error || 'Unknown error';
            console.log(`  - ${videoState.title}`);
            console.log(`    오류: ${error}`);
          }
        }
      }
    });

  return command;
}
```

**Step 3: CLI 인덱스 파일**

Create `src/adapters/cli/index.ts`:

```typescript
import { Command } from 'commander';
import { createSummarizeCommand } from './commands/summarize.js';
import { createStatusCommand } from './commands/status.js';

export function createCLI(): Command {
  const program = new Command()
    .name('yt-summarize')
    .description('YouTube 재생목록을 Gemini로 분석하여 마크다운 요약 생성')
    .version('1.0.0');

  program.addCommand(createSummarizeCommand(), { isDefault: true });
  program.addCommand(createStatusCommand());

  return program;
}
```

**Step 4: 진입점 수정**

Modify `src/index.ts`:

```typescript
#!/usr/bin/env node

import { createCLI } from './adapters/cli/index.js';

const cli = createCLI();
cli.parse(process.argv);
```

**Step 5: 커밋**

```bash
git add src/adapters/ src/index.ts
git commit -m "feat: implement CLI adapter with summarize and status commands"
```

---

## Task 10: 최종 통합 및 테스트

**Step 1: 빌드 테스트**

```bash
npm run build
```

Expected: dist/ 폴더에 컴파일된 파일 생성

**Step 2: .env 설정**

```bash
cp .env.example .env
# .env 파일에 실제 API 키 입력
```

**Step 3: 실행 테스트**

```bash
# 도움말 확인
npm run dev -- --help

# 단일 영상 테스트 (짧은 영상으로)
npm run dev -- --video "https://www.youtube.com/watch?v=SHORT_VIDEO_ID" --locale ko
```

**Step 4: 전체 커밋**

```bash
git add -A
git commit -m "feat: complete youtube playlist summarizer v1.0.0"
```

---

## 완료 후 체크리스트

- [ ] `npm run build` 성공
- [ ] 단일 영상 요약 테스트 성공
- [ ] 재생목록 요약 테스트 성공
- [ ] 스크린샷 캡처 동작 확인
- [ ] 중단 후 재실행 시 상태 복구 확인
- [ ] `yt-summarize status` 명령어 동작 확인
