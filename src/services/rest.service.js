import { pool } from '../db/pool.js';

// Allowed operators for filtering
const OPERATORS = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
};

// Tables accessible via the REST API (whitelist for security)
const ALLOWED_TABLES = new Set([
  'user_profiles',
  'wiki_pages',
  'wiki_files',
]);

export function validateTable(tableName) {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw Object.assign(new Error(`Table '${tableName}' not found or not accessible`), { statusCode: 404 });
  }
}

export function addAllowedTable(tableName) {
  ALLOWED_TABLES.add(tableName);
}

/**
 * Build a SELECT query from query string params.
 * Supports: select, filters (col=eq.value), order, limit, offset
 */
export async function selectRows(table, queryParams, userId, userRole) {
  validateTable(table);

  const conditions = [];
  const values = [];
  let paramIdx = 1;

  // Row-level security: non-admin users can only see their own rows if user_id column exists
  const hasUserIdCol = await columnExists(table, 'user_id');
  if (hasUserIdCol && userRole !== 'admin') {
    conditions.push(`user_id = $${paramIdx++}`);
    values.push(userId);
  }

  // Parse filter params like ?name=eq.John&age=gte.18
  for (const [key, val] of Object.entries(queryParams)) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    const [op, ...rest] = val.split('.');
    const filterVal = rest.join('.');
    if (OPERATORS[op]) {
      conditions.push(`"${key}" ${OPERATORS[op]} $${paramIdx++}`);
      values.push(filterVal);
    }
  }

  // Column selection
  const select = queryParams.select
    ? queryParams.select.split(',').map(c => `"${c.trim()}"`).join(', ')
    : '*';

  // ORDER BY
  let orderClause = '';
  if (queryParams.order) {
    const [col, dir] = queryParams.order.split('.');
    const direction = dir === 'desc' ? 'DESC' : 'ASC';
    orderClause = `ORDER BY "${col}" ${direction}`;
  }

  const limit = Math.min(parseInt(queryParams.limit || '100'), 1000);
  const offset = parseInt(queryParams.offset || '0');

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT ${select} FROM "${table}" ${where} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;

  const result = await pool.query(sql, values);
  return result.rows;
}

export async function insertRow(table, body, userId, userRole) {
  validateTable(table);

  const hasUserIdCol = await columnExists(table, 'user_id');
  if (hasUserIdCol && userRole !== 'admin') {
    body.user_id = userId; // enforce ownership
  }

  const cols = Object.keys(body).map(c => `"${c}"`).join(', ');
  const placeholders = Object.keys(body).map((_, i) => `$${i + 1}`).join(', ');
  const values = Object.values(body);

  const sql = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders}) RETURNING *`;
  const result = await pool.query(sql, values);
  return result.rows[0];
}

export async function updateRow(table, id, body, userId, userRole) {
  validateTable(table);

  // Ownership check
  const hasUserIdCol = await columnExists(table, 'user_id');
  if (hasUserIdCol && userRole !== 'admin') {
    const check = await pool.query(`SELECT user_id FROM "${table}" WHERE id = $1`, [id]);
    if (!check.rows[0] || check.rows[0].user_id !== userId) {
      throw Object.assign(new Error('Not found or access denied'), { statusCode: 403 });
    }
  }

  const sets = Object.keys(body).map((col, i) => `"${col}" = $${i + 1}`).join(', ');
  const values = [...Object.values(body), id];
  const sql = `UPDATE "${table}" SET ${sets} WHERE id = $${values.length} RETURNING *`;

  const result = await pool.query(sql, values);
  if (result.rows.length === 0) throw Object.assign(new Error('Row not found'), { statusCode: 404 });
  return result.rows[0];
}

export async function deleteRow(table, id, userId, userRole) {
  validateTable(table);

  const hasUserIdCol = await columnExists(table, 'user_id');
  if (hasUserIdCol && userRole !== 'admin') {
    const check = await pool.query(`SELECT user_id FROM "${table}" WHERE id = $1`, [id]);
    if (!check.rows[0] || check.rows[0].user_id !== userId) {
      throw Object.assign(new Error('Not found or access denied'), { statusCode: 403 });
    }
  }

  const result = await pool.query(`DELETE FROM "${table}" WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw Object.assign(new Error('Row not found'), { statusCode: 404 });
  return { deleted: true, id };
}

// Cache for column existence checks
const colCache = new Map();
async function columnExists(table, col) {
  const key = `${table}.${col}`;
  if (colCache.has(key)) return colCache.get(key);
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, col]
  );
  const exists = result.rows.length > 0;
  colCache.set(key, exists);
  return exists;
}
