// Role gate. Use as a Fastify preHandler on protected routes.
//
//   app.get('/x', { preHandler: requireRole('founder') }, handler)
//   app.get('/y', { preHandler: requireRole('worker', 'founder') }, handler)
//
// 'admin' always passes. No req.user (unauthenticated) → 401. Wrong role → 403.

export function requireRole(...allowed) {
  return function (req, reply, done) {
    const user = req.user;
    if (!user) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    if (user.role === 'admin' || allowed.includes(user.role)) {
      return done();
    }
    reply.code(403).send({ error: 'forbidden', need: allowed, have: user.role });
  };
}
