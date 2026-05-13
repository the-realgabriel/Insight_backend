export async function authenticate(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

export async function requireRole(role) {
  return async (request, reply) => {
    await authenticate(request, reply);
    if (reply.sent) return;

    if (request.user.role !== role && request.user.role !== 'admin') {
      reply.code(403).send({ error: 'Forbidden', message: `Requires role: ${role}` });
    }
  };
}
