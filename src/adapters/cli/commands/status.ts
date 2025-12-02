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
