import { launchBoardLibraryWindow } from '@veriflow/waveform-desktop';
import type { BoardEditorLauncher } from '../commands/board';

export class NodeBoardEditorLauncher implements BoardEditorLauncher {
    open(configPath: string, options?: Parameters<typeof launchBoardLibraryWindow>[1]): Promise<void> {
        return launchBoardLibraryWindow(configPath, options);
    }
}
