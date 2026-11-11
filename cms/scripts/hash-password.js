const bcrypt = require('bcryptjs');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

(async () => {
  if (!stdin.isTTY) throw new Error('Execute este comando em um terminal interativo.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const password = await rl.question('Nova senha do painel (mínimo 14 caracteres): ');
  rl.close();
  if (password.length < 14) throw new Error('Use uma senha com pelo menos 14 caracteres.');
  console.log('\nHash para ADMIN_PASSWORD_HASH no arquivo .env:\n' + bcrypt.hashSync(password, 12));
})();
