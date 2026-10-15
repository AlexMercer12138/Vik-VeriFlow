import type { PhysicalBoard, PhysicalConfiguration, PhysicalPort } from './physicalPins';

export type PhysicalIoStandard = { name: string; millivolts?: number; differential: boolean; description?: string };
type Rule = PhysicalIoStandard & { banks: string; inputOnly?: boolean; inputAnyVoltage?: boolean; clockOnly?: boolean };
// AMD UG571 v1.16, Tables 1-77/1-78. Names are XDC values, independent of connector roles.
// DCI/VREF/termination requirements remain the user's circuit/IP configuration.
const rules: Rule[] = [];
function add(names: string, millivolts: number, banks = 'hp hr', differential = false, inputOnly = false): void {
    for (const name of names.split(' ')) rules.push({ name, millivolts, banks, differential, inputOnly,
        ...(name.includes('DCI') ? { description: 'Requires DCI reference / IP setup' } : {}) });
}
add('LVCMOS33 LVTTL', 3300, 'hr');
add('LVCMOS25', 2500, 'hr');
add('LVCMOS18', 1800); add('LVCMOS15', 1500); add('LVCMOS12', 1200);
add('HSUL_12', 1200);
add('LVDCI_18 HSLVDCI_18', 1800, 'hp'); add('LVDCI_15 HSLVDCI_15', 1500, 'hp');
add('HSUL_12_DCI', 1200, 'hp');
add('HSTL_I', 1500); add('HSTL_II', 1500, 'hr'); add('HSTL_I_DCI', 1500, 'hp');
add('HSTL_I_18', 1800); add('HSTL_II_18', 1800, 'hr'); add('HSTL_I_DCI_18', 1800, 'hp');
add('HSTL_I_12 HSTL_I_DCI_12', 1200, 'hp');
add('SSTL18_I', 1800); add('SSTL18_II', 1800, 'hr');
for (const [suffix, mv] of [['15', 1500], ['135', 1350], ['12', 1200]] as const) {
    add('SSTL' + suffix, mv); add('SSTL' + suffix + '_DCI', mv, 'hp');
    if (suffix !== '12') add('SSTL' + suffix + '_R', mv, 'hr');
}
add('SSTL18_I_DCI', 1800, 'hp');
add('POD10 POD10_DCI', 1000, 'hp'); add('POD12 POD12_DCI', 1200, 'hp');
for (const rule of [...rules].filter(r => /^(HSTL|SSTL|HSUL|POD)/.test(r.name))) {
    rules.push({ ...rule, name: 'DIFF_' + rule.name, differential: true });
}
add('LVDS', 1800, 'hp', true);
add('LVDS_25 RSDS_25 MINI_LVDS_25 PPDS_25 BLVDS_25', 2500, 'hr', true);
add('TMDS_33', 3300, 'hr', true); add('SUB_LVDS', 1800, 'hp hr', true);
add('SLVS_400_18', 1800, 'hp', true, true); add('SLVS_400_25', 2500, 'hr', true, true);
add('LVPECL', 2500, 'hr', true, true);
add('MIPI_DPHY_DCI', 1200, 'hp', true);
for (const rule of rules) {
    if (rule.differential && rule.name !== 'MIPI_DPHY_DCI' && !rule.name.includes('DCI')) rule.inputAnyVoltage = true;
    if (!rule.differential && /^(HSTL|SSTL|HSUL|POD)/.test(rule.name))
        rule.description = (rule.description ? rule.description + '; ' : '') + 'Input VREF / termination must be configured for the circuit';
}
// HD banks: UG571 Table 3-2, rather than the HR bank differential-output rules.
const hd = new Set('LVCMOS12 LVCMOS15 LVCMOS18 LVCMOS25 LVCMOS33 LVTTL HSUL_12 HSTL_I HSTL_I_18 SSTL18_I SSTL18_II SSTL15 SSTL135 SSTL12 DIFF_HSTL_I DIFF_HSTL_I_18 DIFF_SSTL18_I DIFF_SSTL18_II DIFF_SSTL15 DIFF_SSTL135 DIFF_SSTL12 DIFF_HSUL_12'.split(' '));
for (const rule of rules) if (hd.has(rule.name)) rule.banks += ' hd';
add('SSTL15_II', 1500, 'hd'); add('SSTL135_II', 1350, 'hd');
add('DIFF_SSTL15_II', 1500, 'hd', true); add('DIFF_SSTL135_II', 1350, 'hd', true);
for (const name of ['LVPECL', 'LVDS_25', 'SUB_LVDS', 'SLVS_400_25']) {
    const rule = rules.find(r => r.name === name)!;
    rules.push({ ...rule, banks: 'hd', inputOnly: true, inputAnyVoltage: true, clockOnly: true });
}

export function physicalBankType(board: PhysicalBoard, bank: string | undefined): string | undefined {
    const declared = board.model.banks?.find(b => b.id === bank)?.type;
    if (declared) return declared;
    if (/^xcau15p-ffvb676-/i.test(board.model.device)) {
        if (['64', '65', '66'].includes(bank ?? '')) return 'hp';
        if (['84', '85', '86'].includes(bank ?? '')) return 'hd';
        if (['224', '225', '226'].includes(bank ?? '')) return 'gt';
    }
    return undefined;
}
export function physicalPinVoltage(board: PhysicalBoard, config: PhysicalConfiguration, pin: string): number | undefined {
    const bank = board.model.banks?.find(b => b.id === board.model.fpgaPins.find(p => p.id === pin)?.bank);
    const rail = board.model.rails?.find(r => r.id === bank?.supplyRail);
    if (!Array.isArray(rail?.millivolts)) return rail?.millivolts;
    const value = config.railVoltages?.find(v => v.rail === rail.id)?.millivolts;
    return value !== undefined && rail.millivolts.includes(value) ? value : undefined;
}
export function physicalStandardRules(board: PhysicalBoard, config: PhysicalConfiguration, pinId: string,
    differential: boolean | undefined, direction?: PhysicalPort['direction']): PhysicalIoStandard[] {
    if (board.model.vendor !== 'amd' || !/^(xc|xa|xq)(au|ku|vu|zu)/i.test(board.model.device)) return [];
    const pin = board.model.fpgaPins.find(p => p.id === pinId), bank = physicalBankType(board, pin?.bank);
    if (bank === 'gt') return [{ name: 'GT', differential: true, description: 'Native transceiver; PACKAGE_PIN only, electrical setup belongs to the IP' }];
    const voltage = physicalPinVoltage(board, config, pinId);
    const plus = /^(xc|xa|xq)(au|ku\d+p|vu\d+p|zu)/i.test(board.model.device);
    return rules.filter(rule => rule.banks.split(' ').includes(bank ?? '') && voltage !== undefined
        && (rule.name !== 'MIPI_DPHY_DCI' || plus) && (!rule.clockOnly || pin?.clockCapable)
        && (rule.millivolts === voltage || (direction === 'input' && rule.inputAnyVoltage))
        && (differential === undefined || rule.differential === differential)
        && (!rule.inputOnly || direction === 'input')).map(({ banks: _banks, inputOnly: _input, inputAnyVoltage: _any, clockOnly: _clock, ...rule }) => ({ ...rule,
            ...(rule.millivolts !== voltage ? { millivolts: voltage, description: 'Input only: no internal termination; external signal must meet VIN, VIDIFF and common-mode limits (UG571 Table 1-77)' } : {}) }));
}
