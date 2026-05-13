import { authenticate } from '../middleware/auth.js';
import { selectRows, insertRow, updateRow, deleteRow } from '../services/rest.service.js';

export async function restRoutes(fastify) {
  // GET /rest/v1/:table
  fastify.get('/rest/v1/:table', { preHandler: authenticate }, async (req, reply) => {
    try {
      const rows = await selectRows(req.params.table, req.query, req.user.id, req.user.role);
      return rows;
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  // POST /rest/v1/:table
  fastify.post('/rest/v1/:table', { preHandler: authenticate }, async (req, reply) => {
    try {
      const row = await insertRow(req.params.table, req.body, req.user.id, req.user.role);
      return reply.code(201).send(row);
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  // PATCH /rest/v1/:table/:id
  fastify.patch('/rest/v1/:table/:id', { preHandler: authenticate }, async (req, reply) => {
    try {
      const row = await updateRow(req.params.table, req.params.id, req.body, req.user.id, req.user.role);
      return row;
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  // DELETE /rest/v1/:table/:id
  fastify.delete('/rest/v1/:table/:id', { preHandler: authenticate }, async (req, reply) => {
    try {
      const result = await deleteRow(req.params.table, req.params.id, req.user.id, req.user.role);
      return result;
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });
}
