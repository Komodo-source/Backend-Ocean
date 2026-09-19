// Reusable database calls that back the API routes.
// Run it directly to create + read + delete a throwaway player row:
//
//   node examples/db-calls.js
//
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { pool } = require('../src/db');
const players = require('../src/players');
const { hashPassword } = require('../src/auth');

const USER_NAME = 'example_player';

async function main() {
  // Clean up any leftover row from a previous run.
  await pool.query('delete from public.player where user_name = $1', [USER_NAME]);

  const player = await players.create({
    userName: USER_NAME,
    passwordHash: hashPassword('example-password'),
  });
  console.log('Created:', player);

  console.log('Money:', await players.getMoney(player.id_player));

  await players.setMoney(player.id_player, 5000);
  console.log('After setMoney(5000):', await players.getMoney(player.id_player));

  await players.addMoney(player.id_player, -1250);
  console.log('After addMoney(-1250):', await players.getMoney(player.id_player));

  await players.attachPort(player.id_player, '00000000-0000-4000-8000-000000000001');
  console.log('Ports:', await players.listPorts(player.id_player));

  await players.attachVessel(player.id_player, '00000000-0000-4000-8000-000000000002');
  console.log('Vessels:', await players.listVessels(player.id_player));

  // ON DELETE CASCADE cleans up the join rows too.
  await pool.query('delete from public.player where id_player = $1', [player.id_player]);
  console.log('Cleaned up.');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { main };
