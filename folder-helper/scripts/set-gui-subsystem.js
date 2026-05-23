'use strict';
// Patches a Windows PE executable's subsystem from CONSOLE (3) to WINDOWS_GUI (2).
// This suppresses the console window when the exe is launched.
//
// PE layout used here:
//   0x3C          → 4-byte offset of the PE signature
//   peOffset+4    → COFF header (20 bytes)
//   peOffset+24   → Optional header start
//   optHdr+68     → Subsystem field (2 bytes)  [same offset for PE32 and PE32+]

const fs = require('fs');

const exePath = process.argv[2];
if (!exePath) {
  console.error('Usage: node set-gui-subsystem.js <app.exe>');
  process.exit(1);
}

const buf = fs.readFileSync(exePath);

if (buf[0] !== 0x4D || buf[1] !== 0x5A) {
  console.error('Not a valid PE/MZ executable:', exePath);
  process.exit(1);
}

const peOffset = buf.readUInt32LE(0x3c);
if (buf.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
  console.error('PE signature not found at expected offset');
  process.exit(1);
}

const subsystemOffset = peOffset + 4 + 20 + 68; // PE sig + COFF header + opt header subsystem field
const before = buf.readUInt16LE(subsystemOffset);

if (before === 2) {
  console.log('Already WINDOWS_GUI — no change needed.');
  process.exit(0);
}

buf.writeUInt16LE(2, subsystemOffset);
fs.writeFileSync(exePath, buf);
console.log(`Subsystem patched: ${before} (CONSOLE) → 2 (WINDOWS_GUI)`);
