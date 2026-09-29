#!/usr/bin/env node
'use strict';
/**
 * Tao ADMIN_PASSWORD_HASH de dan vao .env, thay the cho ADMIN_PASSWORD (plaintext).
 * Dung: node scripts/hash-password.js "mat-khau-cua-ban"
 * Neu khong truyen tham so, script se hoi (khong hien ky tu go).
 */
const crypto = require('crypto');
const readline = require('readline');

function hash(pass) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pass, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    process.stdout.write(prompt);
    let out = '';
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', function onData(ch) {
      ch = String(ch);
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode && stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(out);
      } else if (ch === '\u0003') { process.exit(1); }
      else if (ch === '\u007f') { out = out.slice(0, -1); }
      else { out += ch; }
    });
  });
}

(async () => {
  const arg = process.argv[2];
  const pass = arg || await ask('Nhập mật khẩu admin muốn dùng: ');
  if (!pass || pass.length < 8) {
    console.error('Mật khẩu nên dài tối thiểu 8 ký tự.');
    process.exit(1);
  }
  console.log('\nThêm dòng sau vào file .env (xóa/bỏ dòng ADMIN_PASSWORD cũ):\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash(pass)}\n`);
})();
