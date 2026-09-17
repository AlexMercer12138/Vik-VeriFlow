import * as vscode from 'vscode';
import type { NormalizedSimulationExecution } from '@veriflow/flow-core';

const CHANNEL_NAME = 'VeriFlow';

let _channel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel(CHANNEL_NAME);
    }
    return _channel;
}

export function show(preserveFocus?: boolean): void {
    getChannel().show(preserveFocus);
}

export function clear(): void {
    getChannel().clear();
}

export function appendLine(text: string): void {
    getChannel().appendLine(text);
}

export function appendInfo(text: string): void {
    getChannel().appendLine(`[INFO] ${text}`);
}

export function appendSuccess(text: string): void {
    getChannel().appendLine(`[OK] ${text}`);
}

export function appendWarning(text: string): void {
    getChannel().appendLine(`[WARN] ${text}`);
}

export function appendError(text: string): void {
    getChannel().appendLine(`[ERROR] ${text}`);
}

/** Publish backend output once, preserving its combined stream order when available. */
export function appendSimulationResult(result: NormalizedSimulationExecution): string {
    const parts: string[] = [];
    for (const [stage, command] of Object.entries(result.commands ?? {})) {
        if (command) parts.push(`[CMD] ${stage}: ${command}`);
    }
    const transcript = result.combinedOutput || [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (transcript) parts.push(transcript.replace(/\r?\n$/, ''));
    else for (const entry of result.logEntries ?? []) {
        parts.push(`[${entry.level}] ${[entry.fileRef, entry.lineNo, entry.message].filter(value => value !== undefined).join(':')}`);
    }
    if (result.cause?.message && !transcript.includes(result.cause.message)) parts.push(result.cause.message);
    for (const part of parts) appendLine(part);
    if (result.cause?.code === 'ABORTED') appendInfo('Simulation cancelled');
    else if (result.success) appendSuccess('Simulation completed');
    else appendError(`Simulation failed${result.exitCode === undefined ? '' : ` (exit=${result.exitCode})`}`);
    return parts.join('\n');
}

export function dispose(): void {
    if (_channel) {
        _channel.dispose();
        _channel = null;
    }
}
