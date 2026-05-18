import { authenticate } from '../middleware/auth.js';
import { query } from '../db/pool.js';
import { addAllowedTable } from '../services/rest.service.js';

addAllowedTable('wiki_files');

export async function uploadRoutes(fastify) {
  // POST /upload — upload a file (markdown or text) into wiki_files
  fastify.post('/upload', { preHandler: authenticate }, async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    const buffer = await data.toBuffer();
    const content = buffer.toString('utf-8');
    const originalName = data.filename;
    const mimetype = data.mimetype;

    // Only allow text/markdown files
    if (!mimetype.startsWith('text/') && mimetype !== 'application/octet-stream' && !originalName.endsWith('.md')) {
      return reply.code(400).send({ error: 'Only text and markdown files are supported' });
    }

    // Determine the path: use the "uploads" directory prefix
    const path = `uploads/${originalName}`;
    const parentPath = 'uploads';

    // Ensure parent dir exists
    await query(
      `INSERT INTO wiki_files (path, name, type, content, parent_path, user_id)
       VALUES ($1, $2, 'dir', '', $3, $4)
       ON CONFLICT (path) DO NOTHING`,
      ['uploads', 'uploads', '', req.user.id]
    );

    // Insert or update the file
    await query(
      `INSERT INTO wiki_files (path, name, type, content, parent_path, user_id)
       VALUES ($1, $2, 'file', $3, $4, $5)
       ON CONFLICT (path) DO UPDATE SET content = $3, updated_at = NOW()`,
      [path, originalName, content, parentPath, req.user.id]
    );

    return reply.code(201).send({
      path,
      name: originalName,
      type: 'file',
      size: buffer.length,
    });
  });

  // GET /upload/:path — serve uploaded file content
  fastify.get('/upload/*', { preHandler: authenticate }, async (req, reply) => {
    const filePath = (req.params)['*'];
    const result = await query(
      `SELECT content FROM wiki_files WHERE path = $1 AND type = 'file'`,
      [filePath]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'File not found' });
    }
    reply.type('text/markdown; charset=utf-8');
    return reply.send(result.rows[0].content);
  });
}
