/** Q&A: students ask, anyone in the class answers, the asker or staff accept one answer. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isStaff, MEMBERS, requireClassRole } from '../lib/access.js';
import { requireUser } from '../lib/auth.js';
import { audit, one, query, tx } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { idParam, parse, text } from '../lib/validate.js';
import { withAttachments } from '../services/attachments.js';

const questionBody = z.object({ title: text(3, 200), body: z.string().max(20_000).default('') });
const answerBody = z.object({ body: text(1, 10_000) });
const acceptBody = z.object({ answerId: z.string().uuid().nullable() });
const voteBody = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) });
const listQuery = z.object({
  filter: z.enum(['all', 'unanswered', 'mine']).default('all'),
  sort: z.enum(['recent', 'top']).default('recent'),
  q: z.string().trim().max(200).optional(),
});

const score = (kind: 'question' | 'answer', col: string) =>
  `(SELECT COALESCE(sum(value), 0)::int FROM votes v WHERE v.target_kind = '${kind}' AND v.target_id = ${col})`;
const myVote = (kind: 'question' | 'answer', col: string, userParam: string) =>
  `(SELECT value FROM votes v WHERE v.target_kind = '${kind}' AND v.target_id = ${col} AND v.user_id = ${userParam})`;

export default async function qaRoutes(app: FastifyInstance) {
  app.get('/classes/:id/questions', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId, MEMBERS);
    const f = parse(listQuery, req.query);

    const questions = await query(
      `SELECT q.id, q.title, left(q.body, 280) AS excerpt, q.created_at AS "createdAt",
              q.accepted_answer_id IS NOT NULL AS resolved,
              json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url) AS author,
              ${score('question', 'q.id')} AS score,
              (SELECT count(*)::int FROM answers a WHERE a.question_id = q.id AND a.deleted_at IS NULL) AS "answerCount"
         FROM questions q JOIN users u ON u.id = q.author_id
        WHERE q.class_id = $1 AND q.deleted_at IS NULL
          AND ($2 <> 'unanswered' OR NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id = q.id AND a.deleted_at IS NULL))
          AND ($2 <> 'mine' OR q.author_id = $3)
          AND ($4::text IS NULL OR q.title ILIKE '%' || $4 || '%' OR q.body ILIKE '%' || $4 || '%')
        ORDER BY CASE WHEN $5 = 'top' THEN ${score('question', 'q.id')} END DESC NULLS LAST, q.created_at DESC
        LIMIT 200`,
      [id, f.filter, userId, f.q ? escapeLike(f.q) : null, f.sort],
    );
    return { questions };
  });

  app.post('/classes/:id/questions', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await requireClassRole(id, userId);
    const b = parse(questionBody, req.body);
    const q = await one(
      'INSERT INTO questions (class_id, author_id, title, body) VALUES ($1,$2,$3,$4) RETURNING id',
      [id, userId, b.title, b.body],
    );
    reply.code(201);
    return { question: await loadQuestion(q.id, userId) };
  });

  app.get('/questions/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const { class_id } = await questionClass(id);
    await requireClassRole(class_id, userId, MEMBERS);
    return { question: await loadQuestion(id, userId) };
  });

  app.delete('/questions/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const q = await questionClass(id);
    const role = await requireClassRole(q.class_id, userId);
    if (q.author_id !== userId && !isStaff(role)) throw forbidden();
    await query('UPDATE questions SET deleted_at = now() WHERE id = $1', [id]);
    await audit(userId, 'question.delete', 'question', id);
    reply.code(204);
  });

  app.post('/questions/:id/answers', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const { class_id } = await questionClass(id);
    await requireClassRole(class_id, userId);
    const { body } = parse(answerBody, req.body);
    const a = await one('INSERT INTO answers (question_id, author_id, body) VALUES ($1,$2,$3) RETURNING id', [id, userId, body]);
    await query('UPDATE questions SET updated_at = now() WHERE id = $1', [id]);
    reply.code(201);
    // answerId lets the app attach files to the new answer.
    return { question: await loadQuestion(id, userId), answerId: a.id };
  });

  app.delete('/answers/:id', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const a = await one(
      `SELECT a.author_id, q.class_id, q.id AS question_id FROM answers a JOIN questions q ON q.id = a.question_id
        WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [id],
    );
    if (!a) throw notFound('Answer');
    const role = await requireClassRole(a.class_id, userId);
    if (a.author_id !== userId && !isStaff(role)) throw forbidden();
    await tx(async (db) => {
      await db.query('UPDATE answers SET deleted_at = now() WHERE id = $1', [id]);
      await db.query('UPDATE questions SET accepted_answer_id = NULL WHERE id = $1 AND accepted_answer_id = $2', [
        a.question_id,
        id,
      ]);
    });
    await audit(userId, 'answer.delete', 'answer', id);
    reply.code(204);
  });

  /** Accept (or clear with null) the answer that resolved the question. */
  app.post('/questions/:id/accept', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const q = await questionClass(id);
    const role = await requireClassRole(q.class_id, userId);
    if (q.author_id !== userId && !isStaff(role)) throw forbidden('Only the asker or class staff can accept an answer');
    const { answerId } = parse(acceptBody, req.body);
    if (answerId) {
      const a = await one('SELECT 1 FROM answers WHERE id = $1 AND question_id = $2 AND deleted_at IS NULL', [answerId, id]);
      if (!a) throw badRequest('That answer does not belong to this question');
    }
    await query('UPDATE questions SET accepted_answer_id = $2 WHERE id = $1', [id, answerId]);
    return { question: await loadQuestion(id, userId) };
  });

  /** Vote +1 / -1, or 0 to remove your vote. You cannot vote on your own post. */
  app.put('/questions/:id/vote', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const q = await questionClass(id);
    await requireClassRole(q.class_id, userId);
    if (q.author_id === userId) throw badRequest('You cannot vote on your own question');
    const { value } = parse(voteBody, req.body);
    await setVote(userId, 'question', id, value);
    return { score: await currentScore('question', id) };
  });

  app.put('/answers/:id/vote', async (req) => {
    const userId = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const a = await one(
      `SELECT a.author_id, q.class_id FROM answers a JOIN questions q ON q.id = a.question_id
        WHERE a.id = $1 AND a.deleted_at IS NULL AND q.deleted_at IS NULL`,
      [id],
    );
    if (!a) throw notFound('Answer');
    await requireClassRole(a.class_id, userId);
    if (a.author_id === userId) throw badRequest('You cannot vote on your own answer');
    const { value } = parse(voteBody, req.body);
    await setVote(userId, 'answer', id, value);
    return { score: await currentScore('answer', id) };
  });
}

async function questionClass(id: string) {
  const q = await one<{ class_id: string; author_id: string }>(
    'SELECT class_id, author_id FROM questions WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (!q) throw notFound('Question');
  return q;
}

async function setVote(userId: string, kind: 'question' | 'answer', targetId: string, value: number) {
  if (value === 0) {
    await query('DELETE FROM votes WHERE user_id = $1 AND target_kind = $2 AND target_id = $3', [userId, kind, targetId]);
  } else {
    await query(
      `INSERT INTO votes (user_id, target_kind, target_id, value) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, target_kind, target_id) DO UPDATE SET value = EXCLUDED.value, created_at = now()`,
      [userId, kind, targetId, value],
    );
  }
}

async function currentScore(kind: 'question' | 'answer', id: string) {
  const r = await one(`SELECT COALESCE(sum(value), 0)::int AS s FROM votes WHERE target_kind = $1 AND target_id = $2`, [kind, id]);
  return r.s as number;
}

/** Full question with answers; accepted answer first, then by score, then oldest. */
async function loadQuestion(id: string, userId: string) {
  const q = await one(
    `SELECT q.id, q.class_id AS "classId", q.title, q.body, q.created_at AS "createdAt", q.updated_at AS "updatedAt",
            q.accepted_answer_id AS "acceptedAnswerId",
            json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url) AS author,
            ${score('question', 'q.id')} AS score, ${myVote('question', 'q.id', '$2')} AS "myVote"
       FROM questions q JOIN users u ON u.id = q.author_id
      WHERE q.id = $1 AND q.deleted_at IS NULL`,
    [id, userId],
  );
  if (!q) throw notFound('Question');
  q.answers = await query(
    `SELECT a.id, a.body, a.created_at AS "createdAt",
            json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url, 'role', e.role) AS author,
            ${score('answer', 'a.id')} AS score, ${myVote('answer', 'a.id', '$3')} AS "myVote",
            a.id = $2 AS accepted
       FROM answers a JOIN users u ON u.id = a.author_id
       LEFT JOIN enrollments e ON e.user_id = a.author_id AND e.class_id = $4 AND e.valid_to IS NULL
      WHERE a.question_id = $1 AND a.deleted_at IS NULL
      ORDER BY (a.id = $2) DESC NULLS LAST, score DESC, a.created_at`,
    [id, q.acceptedAnswerId, userId, q.classId],
  );
  q.answers = await withAttachments('answer', q.answers);
  q.attachments = (await withAttachments('question', [{ id: q.id }]))[0]!.attachments;
  return q;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
