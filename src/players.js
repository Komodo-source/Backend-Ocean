const { query, withTransaction } = require('./db');

// Never expose password_hash.
const PUBLIC_COLUMNS = 'id_player, user_name, money, created_at, updated_at';

function toPublicPlayer(row) {
  if (!row) return null;
  const { password_hash, ...player } = row;
  return player;
}

async function findById(id) {
  const { rows } = await query(
    `select ${PUBLIC_COLUMNS} from public.player where id_player = $1`,
    [id]
  );
  return rows[0] || null;
}

/** Includes password_hash — only for the login flow. */
async function findByUserNameWithHash(userName) {
  const { rows } = await query(
    `select ${PUBLIC_COLUMNS}, password_hash from public.player where user_name = $1`,
    [userName]
  );
  return rows[0] || null;
}

async function create({ userName, passwordHash }) {
  const { rows } = await query(
    `insert into public.player (user_name, password_hash)
     values ($1, $2)
     returning ${PUBLIC_COLUMNS}`,
    [userName, passwordHash]
  );
  return rows[0];
}

async function getMoney(id) {
  const { rows } = await query(
    'select money from public.player where id_player = $1',
    [id]
  );
  return rows[0] ? rows[0].money : null;
}

/** Sets an absolute balance. Throws on negative values (mirrors the DB check). */
async function setMoney(id, money) {
  const { rows } = await query(
    `update public.player set money = $2, updated_at = now()
     where id_player = $1
     returning money`,
    [id, money]
  );
  return rows[0] ? rows[0].money : null;
}

/** Applies a signed delta atomically and returns the new balance. */
async function addMoney(id, delta) {
  const { rows } = await query(
    `update public.player set money = money + $2, updated_at = now()
     where id_player = $1
     returning money`,
    [id, delta]
  );
  return rows[0] ? rows[0].money : null;
}

async function listVessels(playerId) {
  const { rows } = await query(
    `select v.id_vessel, v.id_vessel as vessel_id
     from public.player_vessel pv
     join public.vessel v on v.id_vessel = pv.vessel_id
     where pv.player_id = $1
     order by v.id_vessel`,
    [playerId]
  );
  return rows;
}

async function listPorts(playerId) {
  const { rows } = await query(
    `select p.id_port, p.id_port as port_id
     from public.player_port pp
     join public.port p on p.id_port = pp.port_id
     where pp.player_id = $1
     order by p.id_port`,
    [playerId]
  );
  return rows;
}

// vessel/port rows hold nothing but their id, so link helpers make sure the
// referenced row exists before the join-table insert (FK requirement).
async function attachVessel(playerId, vesselId) {
  return withTransaction(async (tx) => {
    await tx(
      'insert into public.vessel (id_vessel) values ($1) on conflict (id_vessel) do nothing',
      [vesselId]
    );
    const result = await tx(
      `insert into public.player_vessel (player_id, vessel_id)
       values ($1, $2) on conflict do nothing`,
      [playerId, vesselId]
    );
    return result.rowCount > 0;
  });
}

async function detachVessel(playerId, vesselId) {
  const result = await query(
    'delete from public.player_vessel where player_id = $1 and vessel_id = $2',
    [playerId, vesselId]
  );
  return result.rowCount > 0;
}

async function attachPort(playerId, portId) {
  return withTransaction(async (tx) => {
    await tx(
      'insert into public.port (id_port) values ($1) on conflict (id_port) do nothing',
      [portId]
    );
    const result = await tx(
      `insert into public.player_port (player_id, port_id)
       values ($1, $2) on conflict do nothing`,
      [playerId, portId]
    );
    return result.rowCount > 0;
  });
}

async function detachPort(playerId, portId) {
  const result = await query(
    'delete from public.player_port where player_id = $1 and port_id = $2',
    [playerId, portId]
  );
  return result.rowCount > 0;
}

module.exports = {
  PUBLIC_COLUMNS,
  toPublicPlayer,
  findById,
  findByUserNameWithHash,
  create,
  getMoney,
  setMoney,
  addMoney,
  listVessels,
  listPorts,
  attachVessel,
  detachVessel,
  attachPort,
  detachPort,
};
