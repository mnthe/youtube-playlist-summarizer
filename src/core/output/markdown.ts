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
    const videoLink = this.generateVideoLink(video);
    const summarySection = this.generateSummary(summary, options);
    const keyPoints = this.generateKeyPoints(summary.keyPoints);

    return `${frontmatter}

${videoLink}

---

${summarySection}

---

${keyPoints}
`;
  }

  private generateVideoLink(video: VideoInfo): string {
    // YouTube link must be on its own line (standalone paragraph)
    // for Confluence ADF embedCard to work properly at document root level
    return `[YouTube에서 보기](${video.url})

- **채널**: ${video.channelTitle}
- **길이**: ${this.formatDuration(video.durationSeconds)}`;
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
        // 스크린샷은 screenshotTimestamp 시점의 파일 사용
        const screenshotFile = section.screenshotTimestamp.replace(/:/g, '-');
        content += `![${section.screenshotTimestamp}](./screenshots/${screenshotFile}.png)\n\n`;
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
