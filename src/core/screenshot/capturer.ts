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
