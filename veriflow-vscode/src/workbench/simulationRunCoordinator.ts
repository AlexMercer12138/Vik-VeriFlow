/** Shared, resource-scoped execution gate for graphical tasks and traditional HDL tops. */
export type SimulationRunTarget = Readonly<{ kind: 'st' | 'testbench'; uri: string; module?: string }>;
export class SimulationRunCoordinator {
    private execution?: { target: SimulationRunTarget; cancel: () => void; token: symbol };
    private readonly listeners = new Set<() => void>();
    readonly onDidChange = (listener: () => void): { dispose(): void } => {
        this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } };
    };
    get active(): SimulationRunTarget | undefined { return this.execution?.target; }
    acquire(target: SimulationRunTarget, cancel: () => void): { release(): void } {
        if (this.execution) throw new Error(`A simulation is already running for ${this.execution.target.uri}. Cancel it or wait for it to finish.`);
        const token = Symbol('simulation lease');
        this.execution = { target: Object.freeze({ ...target }), cancel, token }; this.changed();
        return { release: () => { if (this.execution?.token === token) { this.execution = undefined; this.changed(); } } };
    }
    cancel(target: SimulationRunTarget): boolean {
        if (!this.execution || !sameTarget(this.execution.target, target)) return false;
        this.execution.cancel(); return true;
    }
    dispose(): void { this.execution?.cancel(); this.execution = undefined; this.listeners.clear(); }
    private changed(): void { for (const listener of this.listeners) listener(); }
}
function sameTarget(left: SimulationRunTarget, right: SimulationRunTarget): boolean {
    return left.kind === right.kind && left.uri === right.uri && left.module === right.module;
}
