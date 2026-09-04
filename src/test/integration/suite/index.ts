import * as path from 'path';
import Mocha from 'mocha';
import * as fs from 'fs';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 30000
  });

  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    // Find all test files
    const files = fs.readdirSync(testsRoot).filter(f => f.endsWith('.test.js'));

    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
