import { runCli } from './command.js';

runCli(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  () => {
    process.stderr.write('fcm-bridge: could not write the pairing secret\n');
    process.exit(1);
  },
);
