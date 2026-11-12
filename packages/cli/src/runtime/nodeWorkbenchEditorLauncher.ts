import { launchArchDesignEditor, launchSimulationTaskEditor } from '@veriflow/waveform-desktop';
import type { WorkbenchEditorLauncher } from '@veriflow/waveform-desktop';

export class NodeWorkbenchEditorLauncher implements WorkbenchEditorLauncher {
    openArch(filepath: string, options?: { project?: string; lib?: string[] }): Promise<void> {
        return launchArchDesignEditor(filepath, options);
    }

    openTask(filepath: string, options?: { project?: string }): Promise<void> {
        return launchSimulationTaskEditor(filepath, options);
    }
}
