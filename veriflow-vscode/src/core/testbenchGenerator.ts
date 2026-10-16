import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestbenchGenerator as Renderer, type TbConfig } from '@veriflow/hdl-runtime/hdl';
export type { TbConfig, TbModuleConfig } from '@veriflow/hdl-runtime/hdl';
export class TestbenchGenerator extends Renderer {
    generate(config: TbConfig, outputDir: string): string {
        const filepath = path.join(outputDir, `${config.name || 'tb_top'}.v`);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(filepath, this.render(config), 'utf8');
        return filepath;
    }
}
