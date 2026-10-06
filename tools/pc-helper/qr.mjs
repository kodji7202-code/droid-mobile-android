/* global process, Buffer */
// Reads one pairing payload from stdin (never from argv, so it stays out of process listings)
// and prints the QR matrix as rows of 0/1 characters, including a 4-module quiet zone.
import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = Buffer.concat(chunks)
  .toString('utf8')
  .replace(/^\uFEFF/, '')
  .trim();
if (payload === '') {
  process.stderr.write('qr.mjs: empty payload\n');
  process.exit(2);
}

const qr = qrcode(0, 'M');
qr.addData(payload, 'Byte');
qr.make();
const size = qr.getModuleCount();
const total = size + QUIET_ZONE * 2;
const rows = [];
for (let r = 0; r < total; r++) {
  let row = '';
  for (let c = 0; c < total; c++) {
    const rr = r - QUIET_ZONE;
    const cc = c - QUIET_ZONE;
    const dark = rr >= 0 && cc >= 0 && rr < size && cc < size && qr.isDark(rr, cc);
    row += dark ? '1' : '0';
  }
  rows.push(row);
}
process.stdout.write(rows.join('\n') + '\n');
