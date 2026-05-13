import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import { createServer } from 'http';

import { initDb } from './db/init.js';
import { authRoutes } from './routes/auth.routes.js';
import { restRoutes } from './routes/rest.routes.js';
import { startRealtime } from './realtime/server.js';

// Load env vars (in production use a proper dotenv loader or Docker secrets)
const {
  JWT_SECRET = 'change_me_in_production',
  PORT = 3000,
} = process.env;

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  }
});

// CORS
await fastify.register(fastifyCors, {
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// JWT
await fastify.register(fastifyJwt, {
  secret: JWT_SECRET,
  sign: { algorithm: 'HS256' }
});

// Routes
await fastify.register(authRoutes);
await fastify.register(restRoutes);

// Health check
fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// API info
fastify.get('/', async () => ({
  name: 'supabase-clone',
  version: '1.0.0',
  endpoints: {
    auth: [
      'POST /auth/signup',
      'POST /auth/signin',
      'POST /auth/refresh',
      'POST /auth/signout',
      'GET  /auth/me',
    ],
    rest: [
      'GET    /rest/v1/:table',
      'POST   /rest/v1/:table',
      'PATCH  /rest/v1/:table/:id',
      'DELETE /rest/v1/:table/:id',
    ],
    realtime: ['WS /realtime/v1/websocket'],
    health: ['GET /health'],
  }
}));

// Startup
async function start() {
  try {
    await initDb();

    // Use raw Node HTTP server so we can attach WebSocket server to it
    const httpServer = createServer(fastify.server);
    await fastify.ready();

    // Attach WebSocket realtime server
    await startRealtime(fastify.server);

    await fastify.listen({ port: parseInt(PORT), host: '0.0.0.0' });
    console.log(`\n🚀 Supabase Clone running on http://0.0.0.0:${PORT}`);
    console.log(`🔌 Realtime WS: ws://0.0.0.0:${PORT}/realtime/v1/websocket\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
