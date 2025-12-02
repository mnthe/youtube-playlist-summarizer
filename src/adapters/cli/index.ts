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
