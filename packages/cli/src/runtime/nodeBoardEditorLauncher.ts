import { launchBoardLibraryWindow } from '@veriflow/waveform-desktop';
import type { BoardEditorLauncher } from '../commands/board';

export class NodeBoardEditorLauncher implements BoardEditorLauncher {
    open(configPath: string): Promise<void> {
        return launchBoardLibraryWindow(configPath);
    }
}
