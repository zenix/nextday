// Sets (or replaces) the passphrase required to log into the dashboard.
// Run with `npm run set-passphrase`. The server refuses to start without
// one configured — this is the only way to set it, deliberately, so there
// is never a boot-time window where the app is reachable with no auth.
import * as readline from 'readline';
import { hashPassphrase } from '../src/auth/passphrase.js';
import { setAuthRecord } from '../src/config/store.js';

function promptHidden(rl: readline.Interface, query: string): Promise<string> {
  const anyRl = rl as any;
  return new Promise((resolve) => {
    let muted = false;
    anyRl._writeToOutput = (str: string) => {
      anyRl.output.write(muted ? '*'.repeat(str.length) : str);
    };
    rl.question(query, (answer: string) => {
      muted = false;
      anyRl.output.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  console.log('Set the Nextday dashboard passphrase.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let p1: string;
  let p2: string;
  try {
    p1 = await promptHidden(rl, 'New passphrase: ');
    if (p1.length < 8) {
      console.error('\nPassphrase must be at least 8 characters.');
      process.exitCode = 1;
      return;
    }

    p2 = await promptHidden(rl, 'Confirm passphrase: ');
  } finally {
    rl.close();
  }

  if (p1 !== p2) {
    console.error('\nPassphrases did not match — nothing was changed.');
    process.exitCode = 1;
    return;
  }

  const record = await hashPassphrase(p1);
  await setAuthRecord(record);
  console.log('\nPassphrase set. (Re)start the server for it to take effect: npm run dev / npm start');
}

main().catch((err) => {
  console.error('Failed to set passphrase:', err);
  process.exitCode = 1;
});
