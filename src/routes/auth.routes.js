import { signUp, signIn, createRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.js';

const JWT_EXPIRY = parseInt(process.env.JWT_EXPIRY || '3600');

export async function authRoutes(fastify) {
  // POST /auth/signup
  fastify.post('/auth/signup', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 }
        }
      }
    }
  }, async (req, reply) => {
    const { email, password } = req.body;
    try {
      const user = await signUp(email, password);
      const accessToken = fastify.jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        { expiresIn: JWT_EXPIRY }
      );
      const refreshToken = await createRefreshToken(user.id);

      return reply.code(201).send({
        user: { id: user.id, email: user.email, role: user.role },
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: JWT_EXPIRY,
        token_type: 'Bearer'
      });
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  // POST /auth/signin
  fastify.post('/auth/signin', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { email, password } = req.body;
    try {
      const user = await signIn(email, password);
      const accessToken = fastify.jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        { expiresIn: JWT_EXPIRY }
      );
      const refreshToken = await createRefreshToken(user.id);

      return {
        user,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: JWT_EXPIRY,
        token_type: 'Bearer'
      };
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  // POST /auth/refresh
  fastify.post('/auth/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refresh_token'],
        properties: { refresh_token: { type: 'string' } }
      }
    }
  }, async (req, reply) => {
    const { refresh_token } = req.body;
    try {
      const { user, refreshToken } = await rotateRefreshToken(refresh_token);
      const accessToken = fastify.jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        { expiresIn: JWT_EXPIRY }
      );
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: JWT_EXPIRY,
        token_type: 'Bearer'
      };
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  // POST /auth/signout
  fastify.post('/auth/signout', { preHandler: authenticate }, async (req, reply) => {
    const { refresh_token } = req.body || {};
    if (refresh_token) await revokeRefreshToken(refresh_token);
    return { message: 'Signed out successfully' };
  });

  // GET /auth/me
  fastify.get('/auth/me', { preHandler: authenticate }, async (req, reply) => {
    return { user: req.user };
  });
}
