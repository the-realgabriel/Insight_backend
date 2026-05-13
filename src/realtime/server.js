import { WebSocketServer } from 'ws';
import { getListenClient } from '../db/pool.js';
import jwt from 'jsonwebtoken';

/**
 * Realtime engine:
 * - Clients connect via WS with a JWT token
 * - Clients subscribe to specific tables via JSON messages
 * - Postgres LISTEN/NOTIFY broadcasts changes to subscribed clients
 */
export async function startRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });
  const JWT_SECRET = process.env.JWT_SECRET;

  // Map of table -> Set of subscribed WebSocket clients
  const subscriptions = new Map();

  // Start listening to Postgres notifications
  const pgClient = await getListenClient();
  await pgClient.query('LISTEN table_changes');
  console.log('🔌 Realtime: listening on Postgres channel "table_changes"');

  pgClient.on('notification', (msg) => {
    try {
      const payload = JSON.parse(msg.payload);
      const { table, action, data, timestamp } = payload;

      const subs = subscriptions.get(table);
      if (!subs || subs.size === 0) return;

      const message = JSON.stringify({
        type: 'INSERT' === action ? 'INSERT' : action === 'UPDATE' ? 'UPDATE' : 'DELETE',
        table,
        data,
        timestamp,
      });

      for (const ws of subs) {
        if (ws.readyState === ws.OPEN) {
          ws.send(message);
        }
      }
    } catch (err) {
      console.error('Realtime notification error:', err);
    }
  });

  pgClient.on('error', (err) => {
    console.error('Postgres listen client error:', err);
  });

  wss.on('connection', (ws, req) => {
    let user = null;
    const userSubs = new Set(); // tables this client subscribed to

    // Expect first message to be auth
    ws.once('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type !== 'auth' || !msg.token) {
          ws.send(JSON.stringify({ type: 'error', message: 'First message must be auth' }));
          return ws.close();
        }

        user = jwt.verify(msg.token, JWT_SECRET);
        ws.send(JSON.stringify({ type: 'auth_ok', user: { id: user.id, email: user.email } }));

        // Handle subscription messages after auth
        ws.on('message', (raw2) => {
          try {
            const cmd = JSON.parse(raw2.toString());

            if (cmd.type === 'subscribe' && cmd.table) {
              if (!subscriptions.has(cmd.table)) subscriptions.set(cmd.table, new Set());
              subscriptions.get(cmd.table).add(ws);
              userSubs.add(cmd.table);
              ws.send(JSON.stringify({ type: 'subscribed', table: cmd.table }));
            }

            if (cmd.type === 'unsubscribe' && cmd.table) {
              subscriptions.get(cmd.table)?.delete(ws);
              userSubs.delete(cmd.table);
              ws.send(JSON.stringify({ type: 'unsubscribed', table: cmd.table }));
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
          }
        });

      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
        ws.close();
      }
    });

    ws.on('close', () => {
      // Cleanup subscriptions
      for (const table of userSubs) {
        subscriptions.get(table)?.delete(ws);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
    });

    // Send initial ping
    ws.send(JSON.stringify({ type: 'connected', message: 'Send {"type":"auth","token":"<JWT>"} to authenticate' }));
  });

  console.log('🔌 Realtime WebSocket server started at /realtime/v1/websocket');
  return wss;
}
