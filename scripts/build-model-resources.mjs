import { copyPhysicalInterfaces } from './lib/model-resources.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
await copyPhysicalInterfaces(root, path.join(root, 'packages/hdl-runtime/resources/physical-models/interfaces'));
